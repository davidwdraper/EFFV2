// backend/services/svcconfig/src/config.ts

/**
 * SOP-compliant config:
 * - No dotenv loading here (bootstrap.ts loads env).
 * - No hardcoded defaults — all required vars must be present.
 * - Fail fast at import time if something is missing/invalid.
 */

// ── Service identity ──────────────────────────────────────────────────────────
export const SERVICE_NAME = "service-config" as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function requireNumber(name: string): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for env var ${name}: "${raw}"`);
  }
  return n;
}

function requireCsv(name: string): string[] {
  return requireEnv(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  // pass-through (optional)
  env: process.env.NODE_ENV,

  // required
  port: requireNumber("SERVICECONFIG_PORT"),
  mongoUri: requireEnv("SERVICECONFIG_MONGO_URI"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),

  // S2S verification (required)
  s2s: {
    jwtSecret: requireEnv("S2S_JWT_SECRET"),
    audience: requireEnv("S2S_AUDIENCE"),
    allowedIssuers: requireCsv("S2S_ALLOWED_ISSUERS"),
    allowedCallers: requireCsv("S2S_ALLOWED_CALLERS"),
    clockSkewSec: requireNumber("S2S_CLOCK_SKEW_SEC"),
  },

  // Pub/Sub broadcast for gateway hot-reload (optional)
  pubsub: {
    redisUrl: process.env.REDIS_URL,
    redisDisabled: process.env.REDIS_DISABLED,
    channel: process.env.SVCCONFIG_CHANNEL,
  },

  // Health toggle (optional)
  exposeHealth: process.env.EXPOSE_HEALTH,
} as const;
