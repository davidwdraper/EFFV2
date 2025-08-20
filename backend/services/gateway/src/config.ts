// backend/services/gateway/src/config.ts

import { requireEnum, requireNumber, requireEnv } from "../../shared/env";

// NOTE: Env is loaded/validated by ./src/bootstrap first.
// We intentionally do NOT call loadEnvFileOrDie() here to avoid double-loading.

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
export const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true") !== "false";
export const LOG_LEVEL = process.env.LOG_LEVEL;
export const TRACE_ENABLED = process.env.TRACE_ENABLED;
export const TRACE_SAMPLE = process.env.TRACE_SAMPLE;
export const REDACT_HEADERS = process.env.REDACT_HEADERS;
export const AUDIT_ENABLED = process.env.AUDIT_ENABLED;
export const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL;

// ── Strict upstream resolver (no defaults) ────────────────────────────────────
/**
 * Example:
 *   const ACT_URL = requireUpstream("ACT_SERVICE_URL");
 */
export function requireUpstream(
  name:
    | "USER_SERVICE_URL"
    | "ACT_SERVICE_URL"
    | "PLACE_SERVICE_URL"
    | "EVENT_SERVICE_URL"
    | "AUTH_SERVICE_URL"
    | "IMAGE_SERVICE_URL"
) {
  return requireEnv(name);
}

// ── Perf / resilience configs (all required; no defaults) ─────────────────────
export const RATE_LIMIT_WINDOW_MS = requireNumber("RATE_LIMIT_WINDOW_MS"); // e.g., 60000
export const RATE_LIMIT_MAX = requireNumber("RATE_LIMIT_MAX"); // e.g., 300

export const TIMEOUT_GATEWAY_MS = requireNumber("TIMEOUT_GATEWAY_MS"); // e.g., 2000

export const BREAKER_FAILURE_THRESHOLD = requireNumber(
  "BREAKER_FAILURE_THRESHOLD"
); // e.g., 5
export const BREAKER_HALFOPEN_AFTER_MS = requireNumber(
  "BREAKER_HALFOPEN_AFTER_MS"
); // e.g., 30000
export const BREAKER_MIN_RTT_MS = requireNumber("BREAKER_MIN_RTT_MS"); // e.g., 50

// ── Optional convenience alias for consistency in app files ──────────────────
export const serviceName = SERVICE_NAME;

// Structured configs (for direct import in app.ts)
export const rateLimitCfg = {
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
};

export const timeoutCfg = {
  gatewayMs: TIMEOUT_GATEWAY_MS,
};

export const breakerCfg = {
  failureThreshold: BREAKER_FAILURE_THRESHOLD,
  halfOpenAfterMs: BREAKER_HALFOPEN_AFTER_MS,
  minRttMs: BREAKER_MIN_RTT_MS,
};
