// backend/services/user/src/config.ts
import { requireEnv, requireNumber } from "../../shared/config/env";

export const serviceName = requireEnv("USER_SERVICE_NAME");
export const port = requireNumber("USER_PORT");
export const mongoUri = requireEnv("USER_MONGO_URI");
export const jwtSecret = requireEnv("JWT_SECRET"); // required, no fallback
export const logLevel = requireEnv("LOG_LEVEL");
export const logServiceUrl = requireEnv("LOG_SERVICE_URL");

// Upstream helpers (if user service calls others — rare for entity tier)
export function requireUpstream(
  name:
    | "ACT_SERVICE_URL"
    | "PLACE_SERVICE_URL"
    | "EVENT_SERVICE_URL"
    | "LOG_SERVICE_URL"
) {
  return requireEnv(name);
}

export const config = {
  serviceName,
  port,
  mongoUri,
  jwtSecret,
  logLevel,
  logServiceUrl,
  requireUpstream,
};
