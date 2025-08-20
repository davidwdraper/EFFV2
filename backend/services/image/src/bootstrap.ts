// backend/services/image/src/bootstrap.ts
import path from "path";
import {
  loadEnvFromFileOrThrow,
  assertRequiredEnv,
} from "../../shared/config/env";

// In dev: default to .env.dev at repo root if ENV_FILE isn't set.
// In prod: ENV_FILE must be provided explicitly.
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
const resolved = path.resolve(__dirname, "../../../..", envFile);
console.log(`[image.bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

// Ensure all required env vars are present (no implicit fallbacks)
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "IMAGE_SERVICE_NAME",
  "IMAGE_PORT",
  "IMAGE_MONGO_URI",
]);
