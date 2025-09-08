// backend/services/--audit--/src/config.ts

/**
 * SOP-compliant config:
 * - No dotenv loading here (bootstrap.ts loads env).
 * - No hardcoded defaults — all required vars must be present.
 * - Fail fast at import time if something is missing/invalid.
 */

// ── Service identity ──────────────────────────────────────────────────────────
export const SERVICE_NAME = "audit" as const;

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

export const config = {
  // pass-through (optional)
  env: process.env.NODE_ENV,

  // required
  port: requireNumber("AUDIT_PORT"),
  mongoUri: requireEnv("AUDIT_MONGO_URI"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),
} as const;
