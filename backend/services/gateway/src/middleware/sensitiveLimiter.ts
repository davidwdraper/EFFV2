// backend/services/gateway/src/middleware/sensitiveLimiter.ts
import type { RequestHandler } from "express";
import { getRedis } from "../redis/client";

/**
 * Aggressive limiter for enumeration-prone endpoints.
 *
 * ENV:
 *   SENSITIVE_PATH_PREFIXES=/users/email|/users/private     (pipe-delimited)
 *   SENSITIVE_RATE_LIMIT_WINDOW_MS=60000
 *   SENSITIVE_RATE_LIMIT_MAX=30
 */
export function sensitiveLimiter(): RequestHandler {
  const redis = getRedis();
  const prefixes = String(process.env.SENSITIVE_PATH_PREFIXES || "")
    .split("|")
    .filter(Boolean);
  const windowMs = Number(process.env.SENSITIVE_RATE_LIMIT_WINDOW_MS || 60000);
  const max = Number(process.env.SENSITIVE_RATE_LIMIT_MAX || 30);

  return async (req, res, next) => {
    const path = (req.path || "").toLowerCase();
    if (!prefixes.some((p) => p && path.startsWith(p.toLowerCase())))
      return next();

    try {
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
        return res.status(429).json({
          type: "about:blank",
          title: "Too Many Requests",
          status: 429,
          detail: "Rate limit exceeded",
          instance: (req as any).id,
        });
      }
      next();
    } catch {
      next(); // fail-open
    }
  };
}
