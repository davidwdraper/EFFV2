// backend/services/log/src/bootstrap.ts

import path from "path";
import {
  loadEnvFromFileOrThrow,
  assertRequiredEnv,
} from "../../shared/config/env";

// Default to .env.dev if ENV_FILE is not set
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";

// Always resolve relative to the monorepo root
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap] [log] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

// Required envs for the Log service (no defaults, must be present)
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_NAME", // e.g., LOG_SERVICE_NAME=log
  "LOG_MONGO_URI", // MongoDB connection for audit storage
  "LOG_PORT", // port log service listens on
  "LOG_SERVICE_TOKEN_CURRENT", // token clients use to post audits
]);
