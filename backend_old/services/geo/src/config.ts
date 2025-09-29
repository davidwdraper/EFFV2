// backend/services/geo/src/config.ts
/**
 * SOP config: no dotenv here; bootstrap loads env. Fail fast.
 */
export const SERVICE_NAME = "geo" as const;

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
function reqEnum<T extends string>(name: string, allowed: readonly T[]): T {
  const v = req(name) as T;
  if (!allowed.includes(v)) throw new Error(`Invalid ${name}: ${v}`);
  return v;
}
function reqNum(name: string): number {
  const raw = req(name);
  const n = Number(raw);
  if (!Number.isFinite(n))
    throw new Error(`Invalid number for ${name}: ${raw}`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV,
  port: reqNum("GEO_PORT"),
  provider: reqEnum("GEO_PROVIDER", ["google"] as const),
  googleApiKey: req("GEO_GOOGLE_API_KEY"),
  logLevel: req("LOG_LEVEL"),
  logServiceUrl: req("LOG_SERVICE_URL"),
} as const;
