// backend/services/user/index.ts

/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Match the baseline “act” service exactly:
 *   • Use shared `bootstrapService`
 *   • Connect DB in `beforeStart` (port binding happens only after success)
 *   • Lazy-load app after env cascade
 *   • Declare strict required env (S2S + svcconfig mirror inputs)
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

const SERVICE_NAME = "user" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname), // service root (this folder), not /src

  // Connect DB BEFORE binding the port (same pattern as "act")
  beforeStart: async () => {
    // Lazy import after env cascade so connection string is resolved correctly
    const { connectDb } = await import("./src/db");
    await connectDb();
  },

  createApp: () => {
    // Lazy import so env cascade is applied before app/config loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },

  portEnv: "USER_PORT",

  requiredEnv: [
    // Logging/config
    "LOG_LEVEL",
    "LOG_SERVICE_URL",

    // DB (mirror act’s strictness)
    "USER_MONGO_URI",

    // Internal S2S plane (uniform across services)
    "S2S_JWT_SECRET",
    "S2S_JWT_AUDIENCE",

    // svcconfig snapshot inputs for httpClientBySlug and resolution
    "SVCCONFIG_BASE_URL",
    "SVCCONFIG_LKG_PATH",
  ],

  // repoEnvFallback + startSvcconfig are enabled with sane defaults
});
