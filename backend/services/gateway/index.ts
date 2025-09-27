// backend/services/gateway/index.ts

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";
import { validateConfig } from "./src/config";

// ──────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Validate config BEFORE importing anything under ./src that might
// call cfg() at import-time (e.g., middleware wiring inside app.ts).
// This guarantees cfg() is initialized for any module loaded by app.ts.
// ──────────────────────────────────────────────────────────────────────────────
validateConfig();

const SERVICE_NAME = "gateway" as const;

// Validate & cache config BEFORE anything reads it
validateConfig();

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname, "src"),
  createApp: () => {
    // Import after validateConfig() so cfg() is ready.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return (mod.createGatewayApp ?? mod.default ?? mod.app)();
  },
  portEnv: "PORT",
  requiredEnv: [
    // svcconfig / routing guardrails
    "SVCCONFIG_BASE_URL",
    "RATE_LIMIT_WINDOW_MS",
    "RATE_LIMIT_POINTS",
    "TIMEOUT_GATEWAY_MS",
    "BREAKER_FAILURE_THRESHOLD",
    "BREAKER_HALFOPEN_AFTER_MS",
    "BREAKER_MIN_RTT_MS",
    // KMS / JWKS
    "KMS_PROJECT_ID",
    "KMS_LOCATION_ID",
    "KMS_KEY_RING_ID",
    "KMS_KEY_ID",
    "JWKS_CACHE_TTL_MS",
    // Infra
    "REDIS_URL",
  ],
  // Keep defaults strict (no repo fallback); mirror can cold-start for clients
  startSvcconfig: true,
});
