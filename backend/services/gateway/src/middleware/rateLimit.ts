// backend/services/shared/middleware/rateLimit.ts

/**
 * Docs:
 * - Design: docs/design/backend/guardrails/rate-limit.md
 * - Architecture: docs/architecture/backend/GUARDRAILS.md
 * - ADRs:
 *   - docs/adr/0011-global-edge-rate-limiting.md
 *
 * Why:
 * - Provide a **low-cost backstop** against abusive bursts across the API without
 *   external dependencies. This runs **before proxy** and **before audit** so
 *   SECURITY denials never contaminate the billing WAL.
 * - Scope keys to (IP + method + path) to contain abusers without starving
 *   unrelated users or routes.
 *
 * Notes:
 * - Fixed-window, in-memory by default (dev/test and small deployments). For
 *   horizontal scale or strict SLAs, swap the bucket store with Redis or a
 *   distributed limiter but keep this exact interface and behavior.
 * - Fail-open: limiter errors must never take the service down or block traffic.
 * - On deny, we emit a **SECURITY** log (not WAL) and return RFC7807 Problem+JSON
 *   with `Retry-After`.
 */

import type { Request, Response, NextFunction } from "express";
import { logSecurity } from "../utils/securityLog";

export type RateLimitCfg = {
  /** Allowed requests per window per (ip+method+path). */
  points: number;
  /** Window length in milliseconds (fixed window). */
  windowMs: number;
};

/**
 * WHY: Keeping the store in module scope ensures cheap per-request ops.
 * Replace this map with a distributed store for multi-instance deployments.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** WHY: Key ties to IP + method + normalized path to scope abuse precisely. */
function keyFor(req: Request) {
  const ipHeader = (req.headers["x-forwarded-for"] as string) || "";
  const ip =
    ipHeader.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  // Normalize to avoid query noise; we limit by the *route*, not each query variant.
  return `${ip}|${req.method}|${req.path}`;
}

/** WHY: Allow zero-arg usage from createServiceApp(); fall back to env. */
function loadCfgFromEnv(): RateLimitCfg {
  const points = Number(process.env.RATE_LIMIT_POINTS ?? 120);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  return {
    points: Number.isFinite(points) && points > 0 ? points : 120,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  };
}

/**
 * Rate limit guardrail (fixed window).
 * - Denials log to SECURITY channel and return Problem+JSON 429 with Retry-After.
 * - Success path is zero allocation aside from Map lookups/increments.
 */
export function rateLimitMiddleware(cfg?: RateLimitCfg) {
  const cfgResolved = cfg ?? loadCfgFromEnv();
  // Defensive normalization — avoid NaNs/zeros causing odd behavior.
  const points = Math.max(1, cfgResolved.points | 0);
  const windowMs = Math.max(250, cfgResolved.windowMs | 0);

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

      // ─────────────────────────────────────────────────────────────────────
      // Deny branch: emit SECURITY log (never WAL), include short non-PII reason
      // ─────────────────────────────────────────────────────────────────────
      const ipHeader = (req.headers["x-forwarded-for"] as string) || "";
      const clientIp =
        ipHeader.split(",")[0].trim() || req.socket.remoteAddress || "";

      logSecurity(req, {
        kind: "rate_limit",
        reason: "global_backstop_exceeded",
        decision: "blocked",
        status: 429,
        route: req.path,
        method: req.method,
        ip: clientIp,
        details: { limit: points, windowMs, count: b.count },
      });

      // Communicate retry hint. Use whole seconds; sub-second precision is noise.
      const retryInMs = Math.max(0, b.resetAt - now);
      res.setHeader("Retry-After", Math.ceil(retryInMs / 1000));

      // RFC7807 Problem+JSON + correlation key
      const requestId = (req as any).id;
      return res
        .status(429)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Too Many Requests",
          status: 429,
          detail: "Rate limit exceeded",
          instance: req.originalUrl || req.url,
          requestId,
        });
    } catch {
      // Fail-open: protection must not become an availability risk.
      return next();
    }
  };
}
