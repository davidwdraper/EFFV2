// backend/services/auth/src/bootstrap.ts
import path from "path";
import {
  loadEnvFromFileOrThrow,
  assertRequiredEnv,
} from "../../shared/config/env";

// Dev default: use repo-root .env.dev when ENV_FILE not provided
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
// Resolve from monorepo root, not service cwd
const resolved = path.resolve(__dirname, "../../../..", envFile);
console.log(`[auth.bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "AUTH_SERVICE_NAME",
  "AUTH_PORT",
  "JWT_SECRET",
  "USER_SERVICE_URL",
]);
