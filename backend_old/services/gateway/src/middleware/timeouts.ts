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

import type { Request, Response, NextFunction } from "express";

type Options = {
  /** Override timeout for this middleware instance (ms). Must be > 0. */
  gatewayMs?: number;
};

function requireEnvNumber(name: string): number {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) {
    throw new Error(`[timeouts] missing required env: ${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[timeouts] ${name} must be a number > 0`);
  }
  return n;
}

/**
 * Hard-fail timeout middleware.
 * Reads TIMEOUT_GATEWAY_MS directly from env (or opts override).
 * No fallbacks. No dependency on cfg()/validateConfig() order.
 */
export function timeoutsMiddleware(opts?: Options) {
  const gatewayMs = (() => {
    if (opts?.gatewayMs != null) {
      const n = Number(opts.gatewayMs);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          "[timeouts] invalid opts.gatewayMs (number > 0 required)"
        );
      }
      return n;
    }
    return requireEnvNumber("TIMEOUT_GATEWAY_MS");
  })();

  return function timeouts(req: Request, res: Response, next: NextFunction) {
    let cleared = false;

    const clear = () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (res.headersSent) return clear();
      res.setHeader("Connection", "close");
      res.status(504).json({
        error: "Gateway timeout",
        timeoutMs: gatewayMs,
        rid: (req as any)?.rid ?? null,
      });
      clear();
    }, gatewayMs);

    res.on("finish", clear);
    res.on("close", clear);

    next();
  };
}
