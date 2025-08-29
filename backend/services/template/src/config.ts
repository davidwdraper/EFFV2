// backend/services/template/src/config.ts
/**
 * SOP-compliant config:
 * - No dotenv loading here (bootstrap.ts loads env).
 * - No hardcoded defaults — all required vars must be present.
 * - Fail fast at import time if something is missing/invalid.
 */
export const SERVICE_NAME = "template" as const;

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
  if (!Number.isFinite(n))
    throw new Error(`Invalid number for ${name}: "${raw}"`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV,
  port: requireNumber("TEMPLATE_PORT"),
  mongoUri: requireEnv("TEMPLATE_MONGO_URI"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),
  jwtSecret: process.env.JWT_SECRET,
} as const;
