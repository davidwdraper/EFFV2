// backend/services/act/src/bootstrap.ts

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

console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "ACT_MONGO_URI",
  "ACT_PORT",
]);
