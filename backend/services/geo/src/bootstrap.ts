// backend/services/geo/src/bootstrap.ts
import path from "path";
import { loadEnvFileOrDie, assertRequiredEnv } from "@shared/src/env";

const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFileOrDie();

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GEO_PORT",
  "GEO_PROVIDER",
  "GEO_GOOGLE_API_KEY",
]);
