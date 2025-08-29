// backend/services/gateway/src/middleware/rateLimit.ts
import type { RequestHandler } from "express";
import { getRedis } from "../redis/client";

type Cfg = { windowMs: number; max: number };

export function rateLimitMiddleware(cfg: Cfg): RequestHandler {
  const redis = getRedis();
  return async (req, res, next) => {
    try {
      const ip = (
        (req.headers["x-forwarded-for"] as string) ||
        req.ip ||
        "unknown"
      )
        .split(",")[0]
        .trim();
      const authz = (req.headers["authorization"] as string) || "";
      const tier = authz.startsWith("Bearer ") ? "auth" : "anon";
      const key = `rl:${tier}:${ip}`;
      const ttlSec = Math.ceil(cfg.windowMs / 1000);

      // INCR; set EXPIRE only on first hit
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttlSec);

      if (count > cfg.max) {
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
      // Fail-open if Redis is unavailable
      next();
    }
  };
}
