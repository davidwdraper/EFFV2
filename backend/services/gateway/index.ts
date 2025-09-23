// backend/services/gateway/index.ts

/**
 * Docs:
 * - Arch/SOP: docs/architecture/backend/SOP.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Use shared bootstrapService to bind the port and start HTTP.
 * - Lazy-require app *after* envs load so config.ts reads the right envs.
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

const SERVICE_NAME = "gateway" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname, "src"),
  createApp: () => {
    // Lazy import so env cascade is already applied before app/config loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },
  portEnv: "GATEWAY_PORT",
  requiredEnv: [
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    // svcconfig snapshot inputs
    "SVCCONFIG_BASE_URL",
    "SVCCONFIG_LKG_PATH",
    // guardrail configs asserted in config.ts at import time:
    "RATE_LIMIT_WINDOW_MS",
    "RATE_LIMIT_POINTS",
    "TIMEOUT_GATEWAY_MS",
    "BREAKER_FAILURE_THRESHOLD",
    "BREAKER_HALFOPEN_AFTER_MS",
    "BREAKER_MIN_RTT_MS",
    "KMS_PROJECT_ID",
    "KMS_LOCATION_ID",
    "KMS_KEY_RING_ID",
    "KMS_KEY_ID",
    "JWKS_CACHE_TTL_MS",
  ],
});
