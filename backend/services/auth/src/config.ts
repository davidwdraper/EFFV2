// backend/services/auth/src/config.ts
import { requireEnv, requireNumber } from "../../shared/config/env";

/**
 * Auth service config (no defaults; env must be loaded by ./bootstrap).
 * Note: Removed deprecated orchestrator URL and unused mongoUri.
 * Auth is a business-tier service that talks directly to USER_SERVICE_URL.
 */

export const serviceName = requireEnv("AUTH_SERVICE_NAME");
export const port = requireNumber("AUTH_PORT");
export const jwtSecret = requireEnv("JWT_SECRET");
export const userServiceUrl = requireEnv("USER_SERVICE_URL"); // direct to user service (tier-3)
export const logLevel = requireEnv("LOG_LEVEL");
export const logServiceUrl = requireEnv("LOG_SERVICE_URL");

export function requireUpstream(name: "USER_SERVICE_URL") {
  return requireEnv(name);
}

export const config = {
  serviceName,
  port,
  jwtSecret,
  userServiceUrl,
  logLevel,
  logServiceUrl,
  requireUpstream,
};
