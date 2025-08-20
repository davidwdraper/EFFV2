// backend/services/log/src/config.ts
import { requireEnv, requireNumber } from "../../shared/config/env";

/**
 * Canonical config: no defaults, no dotenv here.
 * ENV_FILE is loaded in bootstrap.ts before this is imported.
 *
 * Rotation model:
 * - LOG_SERVICE_TOKEN_CURRENT: required (used by callers; accepted by server)
 * - LOG_SERVICE_TOKEN_PREVIOUS: optional (accepted by server during rollover)
 */
const tokenCurrent = requireEnv("LOG_SERVICE_TOKEN_CURRENT");
const tokenPreviousEnv = process.env.LOG_SERVICE_TOKEN_PREVIOUS;
const tokenPrevious =
  tokenPreviousEnv && tokenPreviousEnv.trim() !== ""
    ? tokenPreviousEnv.trim()
    : null;

export const config = {
  serviceName: requireEnv("LOG_SERVICE_NAME"),
  port: requireNumber("LOG_PORT"),
  mongoUri: requireEnv("LOG_MONGO_URI"),
  logLevel: requireEnv("LOG_LEVEL"),

  // Rotation-aware tokens
  tokenCurrent,
  tokenPrevious,

  // Back-compat: some code may still reference config.serviceToken
  // (maps to "current" so older imports keep working)
  serviceToken: tokenCurrent,
} as const;

/** Authorize if header token matches current or (if set) previous. */
export function isTokenAuthorized(token?: string | null): boolean {
  if (!token) return false;
  return (
    token === config.tokenCurrent ||
    (config.tokenPrevious !== null && token === config.tokenPrevious)
  );
}
