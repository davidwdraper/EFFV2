// backend/services/gateway/src/config.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Centralize explicit env parsing with hard assertions; avoid drift with
 *   middleware contracts by matching field names 1:1.
 */

import { requireEnum, requireNumber, requireEnv } from "@eff/shared/env";

export const SERVICE_NAME = "gateway" as const;

export const NODE_ENV = requireEnum("NODE_ENV", [
  "dev",
  "docker",
  "production",
]);
export const PORT = requireNumber("GATEWAY_PORT");

// Optional toggles
export const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true") !== "false";
export const LOG_LEVEL = process.env.LOG_LEVEL;
export const TRACE_ENABLED = process.env.TRACE_ENABLED;
export const TRACE_SAMPLE = process.env.TRACE_SAMPLE;
export const REDACT_HEADERS = process.env.REDACT_HEADERS;
export const AUDIT_ENABLED = process.env.AUDIT_ENABLED;
export const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL;

// Svcconfig (authoritative)
export const SVCCONFIG_URL = requireEnv("SVCCONFIG_BASE_URL");

export const GATEWAY_FALLBACK_ENV_ROUTES =
  String(process.env.GATEWAY_FALLBACK_ENV_ROUTES || "false").toLowerCase() ===
  "true";

// Redis/pubsub
export const REDIS_URL = process.env.REDIS_URL || "";
export const REDIS_DISABLED =
  String(process.env.REDIS_DISABLED || "false").toLowerCase() === "true";
export const SVCCONFIG_CHANNEL =
  process.env.SVCCONFIG_CHANNEL || "svcconfig:changed";
export const SVCCONFIG_POLL_MS = Number(
  process.env.SVCCONFIG_POLL_MS || 10_000
);

// Allowlist & aliases
const rawAllowed = (process.env.GATEWAY_ALLOWED_SERVICES || "").trim();
export const ALLOWED_SERVICES = rawAllowed
  ? rawAllowed
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : ["*"];

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

// Structured configs
export const rateLimitCfg = {
  windowMs: requireNumber("RATE_LIMIT_WINDOW_MS"),
  points: requireNumber("RATE_LIMIT_POINTS"),
};

export const timeoutCfg = {
  gatewayMs: requireNumber("TIMEOUT_GATEWAY_MS"),
};

export const breakerCfg = {
  failureThreshold: requireNumber("BREAKER_FAILURE_THRESHOLD"),
  halfOpenAfterMs: requireNumber("BREAKER_HALFOPEN_AFTER_MS"),
  minRttMs: requireNumber("BREAKER_MIN_RTT_MS"),
};

export const serviceName = SERVICE_NAME;
