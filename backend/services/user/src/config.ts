// backend/services/user/src/config.ts
import { requireEnv, requireNumber } from "@shared/config/env";

// Service name is baked in bootstrap.ts; do NOT read USER_SERVICE_NAME here.

export const config = {
  port: requireNumber("USER_PORT"),
  mongoUri: requireEnv("USER_MONGO_URI"),
  jwtSecret: requireEnv("JWT_SECRET"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),
  gatewayCoreBaseUrl: requireEnv("GATEWAY_CORE_BASE_URL"),
  cacheTtlSec: Number(process.env.USER_CACHE_TTL_SEC ?? "60"),

  // Upstream helpers (if user service calls others — rare for entity tier)
  requireUpstream(
    name:
      | "ACT_SERVICE_URL"
      | "PLACE_SERVICE_URL"
      | "EVENT_SERVICE_URL"
      | "LOG_SERVICE_URL"
  ) {
    return requireEnv(name);
  },
} as const;

// If you need the service name elsewhere, import from bootstrap:
//   import { SERVICE_NAME } from "./bootstrap";
