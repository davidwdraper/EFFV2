// backend/services/geo/src/bootstrap.ts
import path from "path";
import {
  loadEnvFromFileOrThrow,
  assertRequiredEnv,
} from "../../shared/config/env";

const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GEO_PORT",
  "GEO_PROVIDER",
  "GEO_GOOGLE_API_KEY",
]);
