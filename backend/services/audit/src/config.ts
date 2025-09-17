// backend/services/audit/src/config.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/config.ts
 *
 * Why:
 *   SOP-compliant config:
 *   - No dotenv loading here (bootstrap handles env cascade).
 *   - No silent defaults — required vars must be present/valid.
 *   - Fail fast at import time to surface misconfig early.
 *
 * Notes:
 *   Service name is intentionally NOT exported here; it’s baked into index.ts.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(v);
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
