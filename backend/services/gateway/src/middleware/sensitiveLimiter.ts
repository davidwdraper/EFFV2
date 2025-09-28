// backend/services/gateway/src/middleware/sensitiveLimiter.ts

/**
 * Sensitive Endpoint Limiter (Redis, fixed window)
 * -----------------------------------------------------------------------------
 * Docs:
 * - Design: docs/design/backend/guardrails/rate-limit.md
 * - Architecture: docs/architecture/backend/GUARDRAILS.md
 * - ADRs:
 *   - docs/adr/0011-global-edge-rate-limiting.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - Enumeration-prone routes (auth, email lookups, private resources) need a
 *   stricter throttle than the global backstop to blunt stuffing/discovery.
 *
 * Policy:
 * - Pipe-delimited prefix allowlist chooses which paths are “sensitive”.
 * - Fixed-window counters per client IP in Redis; denials return 429 and log to
 *   the SECURITY channel (never the audit WAL).
 *
 * Non-negotiables:
 * - No env fallbacks. All knobs are required; crash fast on boot if missing.
 * - Fail-open on Redis faults: availability beats protection at the edge.
 */

import type { RequestHandler } from "express";
import { getRedis } from "../redis/client";
import { logSecurity } from "../utils/securityLog";
import { requireEnv, requireNumber } from "@eff/shared/src/env";

// ── Required envs (validated eagerly; no fallbacks) ───────────────────────────
const RAW_PREFIXES = requireEnv("SENSITIVE_PATH_PREFIXES"); // e.g. "/users/email|/auth/verify"
const WINDOW_MS = requireNumber("SENSITIVE_RATE_LIMIT_WINDOW_MS"); // e.g. 60000
const MAX_HITS = requireNumber("SENSITIVE_RATE_LIMIT_MAX"); // e.g. 30

// Parse and normalize prefixes once at module load.
const SENSITIVE_PREFIXES = RAW_PREFIXES.split("|")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.toLowerCase());

if (SENSITIVE_PREFIXES.length === 0) {
  throw new Error(
    "[sensitiveLimiter] SENSITIVE_PATH_PREFIXES yielded no prefixes"
  );
}

/** WHY: match routes quickly without allocations in hot path. */
function isSensitivePath(path: string): boolean {
  const p = (path || "").toLowerCase();
  for (const pref of SENSITIVE_PREFIXES) {
    if (p.startsWith(pref)) return true;
  }
  return false;
}

/** WHY: consistent client IP extraction behind proxies. */
function clientIpOf(req: any): string {
  const xf = (req.headers?.["x-forwarded-for"] as string) || "";
  return (
    xf.split(",")[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  ).trim();
}

/**
 * Middleware: aggressive limiter for sensitive endpoints.
 * - Uses Redis INCR + EXPIRE (fixed window).
 * - Deny path emits SECURITY log and Problem+JSON 429 with optional Retry-After.
 */
export function sensitiveLimiter(): RequestHandler {
  const redis = getRedis(); // rely on client to throw if misconfigured (no silent fallback)
  const ttlSec = Math.ceil(WINDOW_MS / 1000);

  return async (req, res, next) => {
    if (!isSensitivePath(req.path)) return next();

    const ip = clientIpOf(req);
    const key = `rl:sensitive:${ip}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        // First hit starts the window
        await redis.expire(key, ttlSec);
      }

      if (count > MAX_HITS) {
        // Best-effort TTL fetch for Retry-After; omit header if unavailable.
        let remaining = await redis.ttl(key);
        if (typeof remaining === "number" && remaining >= 0) {
          res.setHeader("Retry-After", Math.ceil(remaining).toString());
        }

        // SECURITY log (never WAL)
        // NOTE: SecurityKind does not include "rate_limit_sensitive".
        // Use "rate_limit" and encode sensitivity in reason/details.
        logSecurity(req, {
          kind: "rate_limit",
          reason: "sensitive_backstop_exceeded",
          decision: "blocked",
          status: 429,
          route: req.path,
          method: req.method,
          ip,
          details: {
            limit: MAX_HITS,
            windowMs: WINDOW_MS,
            count,
            category: "sensitive",
          },
        });

        return res
          .status(429)
          .type("application/problem+json")
          .json({
            type: "about:blank",
            title: "Too Many Requests",
            status: 429,
            detail: "Sensitive endpoint rate limit exceeded",
            instance: (req as any).id,
          });
      }

      return next();
    } catch {
      // Fail-open by design: do not add availability risk if Redis is impaired.
      return next();
    }
  };
}
