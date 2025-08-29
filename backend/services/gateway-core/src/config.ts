// backend/services/gateway/src/config.ts
import { requireEnum, requireNumber, requireEnv } from "../../shared/env";

// ── Service identity ──────────────────────────────────────────────────────────
export const SERVICE_NAME = "gateway-core" as const;

// Enforce valid mode (no defaults)
export const NODE_ENV = requireEnum("NODE_ENV", [
  "dev",
  "docker",
  "production",
]);

// Required listen port
export const PORT = requireNumber("GATEWAY_CORE_PORT");

// Optional toggles (ok if missing — no defaults applied)
export const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? "true") !== "false";
export const LOG_LEVEL = process.env.LOG_LEVEL;
export const TRACE_ENABLED = process.env.TRACE_ENABLED;
export const TRACE_SAMPLE = process.env.TRACE_SAMPLE;
export const REDACT_HEADERS = process.env.REDACT_HEADERS;
export const AUDIT_ENABLED = process.env.AUDIT_ENABLED;
export const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL;

// ── Generic upstream access (no service-specific knowledge here) ─────────────
/** Require an upstream by exact ENV KEY, e.g. "ACT_SERVICE_URL". */
export function requireUpstreamByKey(key: string): string {
  return requireEnv(key);
}

// ── Generic routing config ───────────────────────────────────────────────────
// Allowlist (security). In production this MUST be set; in dev, '*' is allowed if unset.
const rawAllowed = (process.env.GATEWAY_ALLOWED_SERVICES || "").trim();
export const ALLOWED_SERVICES = rawAllowed
  ? rawAllowed
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : ["*"];

/**
 * Aliases (env-driven only; no baked defaults).
 * Format: "segment:service,segment2:service2"
 * Example: GATEWAY_ROUTE_MAP="towns:act,images:image"
 *   - "/towns/*" → uses ACT_SERVICE_URL
 *   - "/images/*" → uses IMAGE_SERVICE_URL
 * Unspecified segments use identity ("/users/*" → USER_SERVICE_URL).
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

/**
 * Compute the upstream base URL for the first path segment.
 * - Applies alias (env map)
 * - Naively singularizes for ENV key (users→USER, acts→ACT)
 * - Resolves ENV "<SERVICE>_SERVICE_URL"
 */
export function resolveUpstreamBase(slugRaw: string): {
  svcKey: string;
  base: string;
} {
  const slug = slugRaw.toLowerCase();

  // alias (e.g., "towns" → "act")
  const alias = ROUTE_ALIAS[slug] || slug;

  // singularize naive (users → user, images → image, acts → act)
  const singular = alias.endsWith("s") ? alias.slice(0, -1) : alias;

  // ENV key
  const svcKey = `${singular.toUpperCase()}_SERVICE_URL`; // e.g., USER_SERVICE_URL
  const base = process.env[svcKey];
  if (!base || !base.trim()) {
    throw new Error(
      `Missing required env var: ${svcKey} for route segment "${slugRaw}"`
    );
  }
  return { svcKey, base: base.replace(/\/+$/, "") };
}

// Structured configs (for direct import in app.ts)
export const rateLimitCfg = {
  windowMs: requireNumber("RATE_LIMIT_WINDOW_MS"),
  max: requireNumber("RATE_LIMIT_MAX"),
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
