// backend/services/user/src/bootstrap.ts
import path from "path";
import {
  loadEnvFromFileOrThrow,
  assertRequiredEnv,
} from "../../shared/config/env";

// Dev default: .env.dev at repo root; in prod set ENV_FILE explicitly
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
const resolved = path.resolve(__dirname, "../../../..", envFile);
console.log(`[user.bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

// Require all envs used by this service (no fallbacks)
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "USER_SERVICE_NAME",
  "USER_PORT",
  "USER_MONGO_URI",
  "JWT_SECRET",
]);
