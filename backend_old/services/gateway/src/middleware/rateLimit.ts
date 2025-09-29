// backend/services/shared/middleware/rateLimit.ts

/**
 * Rate Limit Guardrail (fixed window, in-memory)
 * -----------------------------------------------------------------------------
 * Docs:
 * - Design: docs/design/backend/guardrails/rate-limit.md
 * - Architecture: docs/architecture/backend/GUARDRAILS.md
 * - ADRs:
 *   - docs/adr/0011-global-edge-rate-limiting.md
 *
 * Why:
 * - Provide a **low-cost backstop** against abusive bursts across the API before
 *   proxying or auditing. Denials are SECURITY-only (never WAL), per SOP.
 * - Scope keys to (IP + method + path) to contain abusers without starving
 *   unrelated users or routes.
 *
 * Non-negotiables:
 * - **No env fallbacks.** Required knobs must be present; we hard-fail on boot.
 * - This file is shared; keep it dependency-light and explain *why* inline.
 *
 * Notes:
 * - Fixed-window, in-memory by default (dev/test, single instance). For scale,
 *   swap the store with Redis/distributed but keep this interface/behavior.
 * - Fail-open on internal errors: protection must not become an availability risk.
 */

import type { Request, Response, NextFunction } from "express";
import { logSecurity } from "../utils/securityLog";

export type RateLimitCfg = {
  /** Allowed requests per window per (ip+method+path). */
  points: number;
  /** Window length in milliseconds (fixed window). */
  windowMs: number;
};

/** WHY: strict env readers — crash fast if a required knob is missing or invalid. */
function requireNumberEnv(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new Error(`[rateLimit] Missing required env: ${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n))
    throw new Error(`[rateLimit] Env ${name} must be a number`);
  return n;
}

/**
 * WHY: allow construction from env without silent defaults.
 * - RATE_LIMIT_POINTS
 * - RATE_LIMIT_WINDOW_MS
 */
function loadCfgFromEnv(): RateLimitCfg {
  const points = requireNumberEnv("RATE_LIMIT_POINTS");
  const windowMs = requireNumberEnv("RATE_LIMIT_WINDOW_MS");
  if (points <= 0) throw new Error("[rateLimit] RATE_LIMIT_POINTS must be > 0");
  if (windowMs <= 0)
    throw new Error("[rateLimit] RATE_LIMIT_WINDOW_MS must be > 0");
  return { points, windowMs };
}

/**
 * WHY: module-scope store keeps per-request cost tiny.
 * Replace with a distributed store for multi-instance deployments.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** WHY: key ties to IP + method + normalized path to scope abuse precisely. */
function keyFor(req: Request) {
  const ipHeader = (req.headers["x-forwarded-for"] as string) || "";
  const ip =
    ipHeader.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  // Normalize to avoid query noise; we limit by the *route*, not each query variant.
  return `${ip}|${req.method}|${req.path}`;
}

/**
 * Rate limit guardrail (fixed window).
 * - Denials log to SECURITY channel and return Problem+JSON 429 with Retry-After.
 * - Success path is zero allocation aside from Map lookups/increments.
 */
export function rateLimitMiddleware(cfg?: RateLimitCfg) {
  // WHY: no silent defaults — either explicit cfg is provided or env must be complete.
  const cfgResolved = cfg ?? loadCfgFromEnv();

  // Defensive validation (explicit and noisy rather than trying to "fix" inputs).
  if (!Number.isFinite(cfgResolved.points) || cfgResolved.points <= 0) {
    throw new Error("[rateLimit] cfg.points must be a positive number");
  }
  if (!Number.isFinite(cfgResolved.windowMs) || cfgResolved.windowMs <= 0) {
    throw new Error("[rateLimit] cfg.windowMs must be a positive number (ms)");
  }

  const points = Math.floor(cfgResolved.points);
  const windowMs = Math.floor(cfgResolved.windowMs);

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
