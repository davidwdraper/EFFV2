// backend/services/gateway/src/middleware/timeouts.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • Guardrails run before proxy; guardrail denials log SECURITY, not AUDIT.
 *   • “Audit WAL is billing-grade; SecurityLog is for guardrail denials.”
 *
 * Why:
 * Requests that run too long can tie up gateway worker threads, exhaust sockets,
 * and create client-facing hangs. This guardrail enforces a **hard timeout** at
 * the gateway edge:
 *   - If the response has not started within `gatewayMs`, we fail fast with 504.
 *   - This prevents a single bad upstream from consuming resources indefinitely.
 *   - We also emit a SECURITY log for observability (timeout denials are abnormal).
 *
 * Notes:
 * - The timeout only triggers if no headers were sent; if the service responded
 *   partially, we let it complete.
 * - The timer is cleared on both `finish` and `close` to avoid leaks.
 * - Failures are logged as SECURITY (not WAL) because they indicate broken or
 *   malicious traffic, not billable activity.
 */

import type { RequestHandler } from "express";
import { logSecurity } from "../utils/securityLog";

type Cfg = { gatewayMs: number };

export function timeoutsMiddleware(cfg: Cfg): RequestHandler {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        // SECURITY log: abnormal request lifecycle, timed out at the edge.
        logSecurity(req, {
          kind: "timeout",
          reason: "deadline_exceeded",
          decision: "blocked",
          status: 504,
          route: req.path,
          method: req.method,
          details: { gatewayMs: cfg.gatewayMs },
        });

        res.status(504).json({
          type: "about:blank",
          title: "Gateway Timeout",
          status: 504,
          detail: `Request timed out after ${cfg.gatewayMs}ms`,
          instance: (req as any).id,
        });
      }
    }, cfg.gatewayMs);

    // WHY: Always clear timer regardless of success/failure to prevent leaks.
    const clear = () => clearTimeout(timer);
    res.on("finish", clear);
    res.on("close", clear);

    next();
  };
}
