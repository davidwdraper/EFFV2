// backend/services/gateway/src/config.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Audit-ready config: explicit env validation, no silent fallbacks”
 *   • “Guardrails before audit; instrumentation everywhere”
 * - Middleware contracts (this repo, current session)
 *   • rateLimit.ts expects RateLimitCfg = { points, windowMs }
 *   • timeouts.ts expects { gatewayMs }
 *   • circuitBreaker.ts expects { failureThreshold, halfOpenAfterMs, minRttMs }
 *
 * Why:
 * Centralized, *explicit* config loader with hard env assertions. This file is
 * the single source of truth for app assembly to avoid type drift between
 * middleware contracts and process env wiring. We keep names aligned with each
 * middleware’s exported types (e.g., `points` not `max`) to prevent TS mismatch.
 */

import { requireEnum, requireNumber, requireEnv } from "../../shared/src/env";

// ── Service identity ──────────────────────────────────────────────────────────
export const SERVICE_NAME = "gateway" as const;

// Enforce valid mode (no defaults)
export const NODE_ENV = requireEnum("NODE_ENV", [
  "dev",
  "docker",
  "production",
]);

// Required listen port
export const PORT = requireNumber("GATEWAY_PORT");

// Optional toggles (ok if missing — no defaults applied)
// WHY: keep booleans string-based to avoid accidental truthiness.
export const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true") !== "false";
export const LOG_LEVEL = process.env.LOG_LEVEL;
export const TRACE_ENABLED = process.env.TRACE_ENABLED;
export const TRACE_SAMPLE = process.env.TRACE_SAMPLE;
export const REDACT_HEADERS = process.env.REDACT_HEADERS;
export const AUDIT_ENABLED = process.env.AUDIT_ENABLED;
export const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL;

// ── DB-driven service-config pointer (authoritative) ─────────────────────────
export const SVCCONFIG_URL = requireEnv("SVCCONFIG_BASE_URL");

// Never fall back to *_SERVICE_URL envs (kill legacy behavior)
export const GATEWAY_FALLBACK_ENV_ROUTES =
  String(process.env.GATEWAY_FALLBACK_ENV_ROUTES || "false").toLowerCase() ===
  "true";

// ── Redis/pubsub (optional; we still poll as a safety net) ───────────────────
export const REDIS_URL = process.env.REDIS_URL || "";
export const REDIS_DISABLED =
  String(process.env.REDIS_DISABLED || "false").toLowerCase() === "true";
export const SVCCONFIG_CHANNEL =
  process.env.SVCCONFIG_CHANNEL || "svcconfig:changed";

// Poll every N ms as safety net (even if Redis is off)
export const SVCCONFIG_POLL_MS = Number(
  process.env.SVCCONFIG_POLL_MS || 10_000
);

// ── Routing allowlist & aliases (still supported) ────────────────────────────
// WHY: In production, an explicit allowlist is required; in dev, '*' is tolerated.
const rawAllowed = (process.env.GATEWAY_ALLOWED_SERVICES || "").trim();
export const ALLOWED_SERVICES = rawAllowed
  ? rawAllowed
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : ["*"];

/**
 * Aliases (env-controlled only).
 * Format: "segment:service,segment2:service2"
 * Example: GATEWAY_ROUTE_MAP="towns:act,images:image"
 *   - "/towns/*" → resolves slug "act"
 *   - "/images/*" → resolves slug "image"
 */
function parseAliasMap(): Record<string, string> {
  const raw = (process.env.GATEWAY_ROUTE_MAP || "").trim();
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [k, v] = pair.split(":").map((s) => s.trim().toLowerCase());
    if (k && v) out[k] = v;
  }
  return out;
}
export const ROUTE_ALIAS: Record<string, string> = parseAliasMap();

export function isAllowedServiceSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (ALLOWED_SERVICES.includes("*")) return true;
  return (
    ALLOWED_SERVICES.includes(s) ||
    ALLOWED_SERVICES.includes(ROUTE_ALIAS[s] || s)
  );
}

// ── Structured configs (imported by app.ts) ──────────────────────────────────
// WHY: Keep names aligned with middleware types to avoid TS errors.

// General rate limiter (global backstop):
// rateLimit.ts expects: { points, windowMs }
export const rateLimitCfg = {
  windowMs: requireNumber("RATE_LIMIT_WINDOW_MS"),
  points: requireNumber("RATE_LIMIT_POINTS"), // ⬅️ renamed from MAX → POINTS to match contract
};

// Gateway hard timeout:
export const timeoutCfg = {
  gatewayMs: requireNumber("TIMEOUT_GATEWAY_MS"),
};

// Circuit breaker thresholds:
export const breakerCfg = {
  failureThreshold: requireNumber("BREAKER_FAILURE_THRESHOLD"),
  halfOpenAfterMs: requireNumber("BREAKER_HALFOPEN_AFTER_MS"),
  minRttMs: requireNumber("BREAKER_MIN_RTT_MS"),
};

// Back-compat alias (some files import serviceName)
export const serviceName = SERVICE_NAME;
