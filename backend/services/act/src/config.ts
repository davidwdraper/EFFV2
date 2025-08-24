// backend/services/act/src/config.ts

/**
 * SOP-compliant config:
 * - No dotenv loading here (bootstrap.ts loads env).
 * - No hardcoded defaults — all required vars must be present.
 * - Fail fast at import time if something is missing/invalid.
 */

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
  serviceName: requireEnv("ACT_SERVICE_NAME"),
  port: requireNumber("ACT_PORT"),
  mongoUri: requireEnv("ACT_MONGO_URI"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),

  // optional
  jwtSecret: process.env.JWT_SECRET,
} as const;
