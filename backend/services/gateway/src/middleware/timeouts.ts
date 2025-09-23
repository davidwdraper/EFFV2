// backend/services/gateway/src/middleware/timeouts.ts

/**
 * Gateway timeout guardrail (request-scoped 504)
 * -----------------------------------------------------------------------------
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Design: docs/design/backend/guardrails/timeouts.md
 * - ADRs:
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md   // consistency of edge guardrails
 *
 * Why:
 * - Edge must **fail fast and loudly** when upstream work exceeds our SLO. This
 *   middleware assigns a single request-scoped timer and returns an RFC7807 504
 *   if it fires. Guardrail denials log to SECURITY, not the audit WAL (per SOP).
 *
 * Order:
 * - Mount before circuit breaker and before proxying so the 5xx assignment is
 *   attributed to the gateway (traceable via trace5xx and the SECURITY log).
 *
 * Non-negotiables:
 * - **No env fallbacks here.** Caller must pass a validated config (ms > 0).
 * - Never double-send: once headers are sent or the timer fires, we stop.
 *
 * Notes:
 * - We do not attempt to abort upstream sockets here; the streaming proxy (or
 *   S2S client) owns upstream cancellation. This guardrail only protects edge SLO.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logSecurity } from "../utils/securityLog";

export type Cfg = { gatewayMs: number };

/** Hard validation — crash on boot if the caller passed junk. */
function assertCfg(cfg: Cfg): asserts cfg is Cfg {
  if (
    !cfg ||
    typeof cfg.gatewayMs !== "number" ||
    !Number.isFinite(cfg.gatewayMs) ||
    cfg.gatewayMs <= 0
  ) {
    throw new Error(
      "[timeouts] invalid config: { gatewayMs:number>0 } is required"
    );
  }
}

/**
 * Middleware: send 504 after `gatewayMs` unless the response finishes/closes.
 */
export function timeoutsMiddleware(cfg: Cfg): RequestHandler {
  assertCfg(cfg);

  return (req: Request, res: Response, next: NextFunction) => {
    let fired = false;

    // WHY: one timer per request; any completion clears it.
    const timer = setTimeout(() => {
      if (res.headersSent || fired) return;
      fired = true;

      // SECURITY channel (not WAL): timeout at the edge
      logSecurity(req, {
        kind: "timeout",
        reason: "gateway_slo_exceeded",
        decision: "blocked",
        status: 504,
        route: req.path,
        method: req.method,
        details: { gatewayMs: cfg.gatewayMs },
      });

      res
        .status(504)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Gateway Timeout",
          status: 504,
          detail: `Request timed out after ${cfg.gatewayMs}ms`,
          instance: (req as any).id,
        });
    }, cfg.gatewayMs);

    // WHY: clear timer on any terminal event to avoid stray work
    const clear = () => {
      try {
        clearTimeout(timer);
      } catch {
        /* no-op */
      }
    };
    res.once("finish", clear);
    res.once("close", clear);

    next();
  };
}
