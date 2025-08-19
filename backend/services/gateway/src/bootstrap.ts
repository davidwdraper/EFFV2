// backend/services/gateway/src/bootstrap.ts

import path from "path";
import {
  loadEnvFromFileOrThrow,
  assertRequiredEnv,
} from "../../shared/config/env";

// Dev-friendly default for local runs; override explicitly with ENV_FILE when needed.
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";

// Always resolve from the monorepo root (same as Act)
const resolved = path.resolve(__dirname, "../../../..", envFile);
console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

// Validate required env for the gateway up front.
// (If your config uses different names, adjust here; these match the typical gateway setup.)
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "SERVICE_NAME",
  "GATEWAY_PORT",
  // Add other mandatory gateway vars here (e.g., upstream URLs, secrets):
  // "UPSTREAM_ACT_URL",
  // "UPSTREAM_USER_URL",
]);
