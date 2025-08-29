// backend/services/template/src/bootstrap.ts
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

if (process.env.SERVICE_NAME === "template") {
  throw new Error(
    "Template service must not be run directly. Clone/rename it first."
  );
}

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "TEMPLATE_MONGO_URI",
  "TEMPLATE_PORT",
]);
