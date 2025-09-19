// backend/services/auth/src/config.ts
/**
 * Docs:
 * - Design: docs/design/backend/config/env-loading.md
 * - Arch:   docs/architecture/backend/CONFIG.md
 * - SOP:    docs/architecture/backend/SOP.md
 *
 * Why:
 * - Centralized, strict config for Auth. No dotenv here (bootstrap loads env).
 * - Fail fast if required envs are missing/invalid.
 */

import { requireEnv, requireNumber } from "@eff/shared/src/env";

export const config = {
  env: process.env.NODE_ENV,
  port: requireNumber("AUTH_PORT"),
  jwtSecret: requireEnv("JWT_SECRET"),
  logLevel: requireEnv("LOG_LEVEL"),
  logServiceUrl: requireEnv("LOG_SERVICE_URL"),
  // upstream (kept as envs per SOP; handlers read these)
  userSlug: requireEnv("USER_SLUG"),
  userApiVersion: requireEnv("USER_SLUG_API_VERSION"),
  userRouteUsers: requireEnv("USER_ROUTE_USERS"),
  userRoutePrivateEmail: requireEnv("USER_ROUTE_PRIVATE_EMAIL"),
} as const;
