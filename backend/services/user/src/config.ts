// backend/services/user/src/config.ts
export const SERVICE_NAME = "user" as const;

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
  env: process.env.NODE_ENV,

  port: requireNumber("USER_PORT"),
  mongoUri: requireEnv("USER_MONGO_URI"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),
} as const;
