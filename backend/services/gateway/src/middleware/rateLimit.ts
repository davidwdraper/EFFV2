// backend/services/gateway/src/middleware/rateLimit.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • Guardrails run BEFORE proxy; audit (billing) happens AFTER guardrails
 *   • “Security telemetry vs Billing-grade audit” split
 *   • “Instrumentation everywhere; never block foreground traffic”
 *
 * Why:
 * This is the **general** edge rate limiter (distinct from `sensitiveLimiter`).
 * It provides a low-cost backstop against abusive bursts across the API without
 * introducing external dependencies. It:
 *   1) Tracks requests per (IP + method + path) in-memory (fixed window).
 *   2) Responds with 429 when the window’s `points` are exceeded.
 *   3) Emits a **SECURITY** log on denial (so ops can see abuse) but does NOT
 *      write to the audit WAL (billing remains clean).
 *
 * Notes:
 * - In-memory is intentional for dev/test and small deployments. For horizontal
 *   scale or strict SLAs, swap this with a distributed limiter (e.g., Redis) but
 *   keep this exact interface so call sites do not change.
 * - Failures of the limiter must never crash or block requests; worst case is a
 *   noisier log or reduced protection for that request.
 */

import type { Request, Response, NextFunction } from "express";
import { logSecurity } from "../utils/securityLog";

// Public config surface — keep tiny and explicit.
export type RateLimitCfg = {
  /** Allowed requests per window per (ip+method+path). */
  points: number;
  /** Window length in milliseconds (fixed window). */
  windowMs: number;
};

// Fixed-window counters per key. For production, replace with distributed store.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** WHY: Key ties to IP + method + normalized path to scope abuse without cross-user starvation. */
function keyFor(req: Request) {
  const ip =
    (req.headers["x-forwarded-for"] as string) ||
    req.socket.remoteAddress ||
    "unknown";
  // Normalize to avoid query noise; we rate-limit the *route*, not each query variant.
  return `${ip.split(",")[0].trim()}|${req.method}|${req.path}`;
}

export function rateLimitMiddleware(cfg: RateLimitCfg) {
  // Defensive normalization — avoid NaNs/zeros causing odd behavior.
  const points = Math.max(1, cfg.points | 0);
  const windowMs = Math.max(250, cfg.windowMs | 0);

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = Date.now();
      const k = keyFor(req);
      const b = buckets.get(k);

      if (!b || b.resetAt <= now) {
        // Start a fresh window.
        buckets.set(k, { count: 1, resetAt: now + windowMs });
        return next();
      }

      if (b.count < points) {
        b.count++;
        return next();
      }

      // Deny branch: emit SECURITY log, do NOT touch audit WAL (billing).
      logSecurity(req, {
        kind: "rate_limit",
        reason: "global_backstop_exceeded",
        decision: "blocked",
        status: 429,
        route: req.path,
        method: req.method,
        ip:
          (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
          req.socket.remoteAddress ||
          "",
        details: { limit: points, windowMs, count: b.count },
      });

      // Communicate retry hint. Use whole seconds; clients don’t benefit from ms precision.
      const retryInMs = Math.max(0, b.resetAt - now);
      res.setHeader("Retry-After", Math.ceil(retryInMs / 1000));

      return res.status(429).json({
        type: "about:blank",
        title: "Too Many Requests",
        status: 429,
        detail: "Rate limit exceeded",
        instance: (req as any).id,
      });
    } catch {
      // Fail-open: protection must not become an availability risk.
      return next();
    }
  };
}
