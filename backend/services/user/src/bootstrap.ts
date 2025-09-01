// backend/services/user/src/bootstrap.ts

import path from "path";
import { loadEnvFromFileOrThrow, assertRequiredEnv } from "@shared/config/env";

// ── Service identity (allowed to be baked in) ────────────────────────────────
export const SERVICE_NAME = "user" as const;
// Expose to libs that only read process.env
process.env.SERVICE_NAME = SERVICE_NAME;

// ── ENV file resolution ─────────────────────────────────────────────────────
// Require ENV_FILE to be set externally (no defaults baked in).
const envFile = process.env.ENV_FILE;
if (!envFile || !envFile.trim()) {
  throw new Error(
    `[bootstrap:${SERVICE_NAME}] ENV_FILE is required (none provided)`
  );
}

// Always resolve relative to the monorepo root
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap:${SERVICE_NAME}] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

// ── Required envs for this service (do NOT require USER_SERVICE_NAME) ───────
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GATEWAY_CORE_BASE_URL",
  "USER_MONGO_URI",
  "USER_PORT",
  "JWT_SECRET",
  // add "USER_CACHE_TTL_SEC" here if you want to enforce cache TTL explicitly
]);
