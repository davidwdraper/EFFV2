// backend/services/log/src/middleware/rateLimit.ts
import type { Request, Response, NextFunction } from "express";

const ENABLED =
  String(process.env.LOG_INGEST_RL_ENABLED || "").toLowerCase() === "true";

// Fail fast if enabled but missing knobs (SOP: no silent fallbacks)
const RPS = ENABLED ? Number(process.env.LOG_INGEST_RPS) : 0;
const BURST = ENABLED ? Number(process.env.LOG_INGEST_BURST) : 0;
if (
  ENABLED &&
  (!Number.isFinite(RPS) || RPS <= 0 || !Number.isFinite(BURST) || BURST <= 0)
) {
  throw new Error(
    "Rate limiting enabled but LOG_INGEST_RPS/LOG_INGEST_BURST not set to positive numbers"
  );
}

type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();

function keyFrom(req: Request): string {
  const hdr = req.headers["x-internal-key"];
  const token = Array.isArray(hdr) ? hdr[0] : hdr;
  if (typeof token === "string" && token.trim() !== "") return `tok:${token}`;
  // fallback to ip (trust proxy should be set at app level)
  return `ip:${req.ip}`;
}

export function rateLimitIngest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!ENABLED) return next();

  const now = Date.now();
  const key = keyFrom(req);
  const b = buckets.get(key) || { tokens: BURST, last: now };
  // refill
  const elapsed = (now - b.last) / 1000;
  const refill = elapsed * RPS;
  b.tokens = Math.min(BURST, b.tokens + refill);
  b.last = now;

  if (b.tokens < 1) {
    buckets.set(key, b);
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many log events" },
    });
  }

  b.tokens -= 1;
  buckets.set(key, b);
  return next();
}
