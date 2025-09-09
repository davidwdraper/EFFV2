// backend/services/gateway/src/middleware/sensitiveLimiter.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • Guardrails run before auditCapture; guardrail denials log SECURITY, not AUDIT.
 *   • “Audit WAL is billing-grade; SecurityLog is for guardrail denials.”
 *
 * Why:
 * Certain endpoints are **enumeration-prone** (e.g., `/users/email`, `/users/private`).
 * Attackers hammer these to brute-force or enumerate accounts.
 *
 * This guardrail:
 *   - Reads a configured list of sensitive path prefixes from env.
 *   - Tracks requests per client IP in Redis.
 *   - If the request count exceeds the threshold within the time window,
 *     returns 429 (Too Many Requests).
 *   - Logs the denial via `logSecurity` so ops can monitor abuse without polluting
 *     the billing-grade audit WAL.
 *
 * Notes:
 * - Fail-open on Redis errors: better to allow traffic than block legitimate users
 *   because of infra hiccups.
 * - Aggressive by design; tune `SENSITIVE_RATE_LIMIT_*` envs as needed.
 * - Works in conjunction with the general `rateLimitMiddleware` (this is a “hot zone” override).
 */

import type { RequestHandler } from "express";
import { getRedis } from "../redis/client";
import { logSecurity } from "../utils/securityLog";

export function sensitiveLimiter(): RequestHandler {
  const redis = getRedis();

  // WHY: pipe-delimited string from env makes it easy to tune at runtime.
  const prefixes = String(process.env.SENSITIVE_PATH_PREFIXES || "")
    .split("|")
    .filter(Boolean);

  // WHY: fallback values are opinionated defaults; they still can be overridden by env.
  const windowMs = Number(process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS || 60000);
  const max = Number(process.env.SENSITIVE_RATE_LIMIT_MAX || 30);

  return async (req, res, next) => {
    const path = (req.path || "").toLowerCase();

    // Only enforce on configured sensitive prefixes.
    if (!prefixes.some((p) => p && path.startsWith(p.toLowerCase())))
      return next();

    try {
      // WHY: use first IP in X-Forwarded-For if present; fallback to req.ip.
      const ip = (
        (req.headers["x-forwarded-for"] as string) ||
        req.ip ||
        "unknown"
      )
        .split(",")[0]
        .trim();

      const key = `rl:sensitive:${ip}`;
      const ttl = Math.ceil(windowMs / 1000);

      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttl);

      if (count > max) {
        // SECURITY log instead of audit: this is hostile/abusive traffic.
        logSecurity(req, {
          kind: "rate_limit",
          reason: "sensitive_path_exceeded",
          decision: "blocked",
          status: 429,
          route: path,
          method: req.method,
          ip,
          details: { windowMs, max, count },
        });

        return res.status(429).json({
          type: "about:blank",
          title: "Too Many Requests",
          status: 429,
          detail: "Rate limit exceeded",
          instance: (req as any).id,
        });
      }

      next();
    } catch (err) {
      // WHY: fail-open — availability > protection if Redis is flaky.
      next();
    }
  };
}
