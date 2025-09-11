// backend/services/gateway/src/bootstrap.ts

import path from "path";
import { loadEnvFileOrDie, assertRequiredEnv } from "@shared/src/env";

// Dev-friendly default for local runs; override with ENV_FILE when needed.
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";

// Always resolve from the monorepo root
const resolved = path.resolve(__dirname, "../../../..", envFile);
console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFileOrDie();

// Validate only what the gateway itself truly needs at boot.
// DO NOT require SERVICE_NAME; it's set in code (src/config.ts).
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GATEWAY_PORT",
  // Keep the list minimal. Other values are validated lazily where used:
  // "RATE_LIMIT_WINDOW_MS",
  // "RATE_LIMIT_MAX",
  // "TIMEOUT_GATEWAY_MS",
  // "BREAKER_FAILURE_THRESHOLD",
  // "BREAKER_HALFOPEN_AFTER_MS",
  // "BREAKER_MIN_RTT_MS",
  // "REDIS_URL",
  // etc.
]);
