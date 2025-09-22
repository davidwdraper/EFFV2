// backend/services/act/index.ts

/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Standardize boot with shared `bootstrapService` and ensure Mongo is connected
 *   BEFORE the HTTP server binds its port (via `beforeStart` hook).
 * - Keeps act aligned with gateway/user boot flow.
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

export const SERVICE_NAME = "act" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname), // service root (this folder), not /src
  // Connect DB BEFORE binding the port
  beforeStart: async () => {
    // Lazy import after env is loaded
    const { connectDb } = await import("./src/db");
    await connectDb();
  },
  createApp: () => {
    // Lazy import so env cascade is applied before app/config loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },
  portEnv: "ACT_PORT",
  requiredEnv: [
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    "ACT_MONGO_URI",
    // internal S2S plane
    "S2S_JWT_SECRET",
    "S2S_JWT_AUDIENCE",
    // svcconfig snapshot inputs for httpClientBySlug
    "SVCCONFIG_BASE_URL",
    "SVCCONFIG_LKG_PATH",
  ],
  // repoEnvFallback + startSvcconfig use sane defaults from bootstrapService
});
