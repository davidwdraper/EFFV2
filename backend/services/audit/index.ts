// backend/services/audit/index.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/index.ts
 * Service Slug: audit
 *
 * Why:
 *   Standardize boot using shared `bootstrapService` so Mongo is connected and
 *   the Audit WAL is replayed **before** the HTTP server binds its port.
 *   Matches the Act/User boot flow for zero-drift operations.
 *
 * References:
 *   SOP: docs/architecture/backend/SOP.md (New-Session SOP v4, Amended)
 *   Arch: docs/architecture/backend/OVERVIEW.md
 *   Boot: docs/architecture/backend/BOOTSTRAP.md
 *   ADR: docs/adr/0003-shared-app-builder.md
 *   ADR: docs/adr/0017-environment-loading-and-validation.md
 *   ADR: docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   ADR: docs/adr/0027-entity-services-on-shared-createServiceApp.md
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

const SERVICE_NAME = "audit" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname), // service root (this folder), not /src

  // Connect DB and replay WAL BEFORE binding the port
  beforeStart: async () => {
    const { connectDb } = await import("./src/db");
    const { preflightWALReplay } = await import("./src/bootstrap/walbootstrap");
    await connectDb();
    await preflightWALReplay();
  },

  // Lazy import so env cascade is applied before app/config loads
  createApp: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },

  portEnv: "AUDIT_PORT",

  requiredEnv: [
    // logging plane
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    // database
    "AUDIT_MONGO_URI",
    // internal S2S plane
    "S2S_JWT_SECRET",
    "S2S_JWT_AUDIENCE",
    // svcconfig snapshot inputs for httpClientBySlug (parity with Act/User)
    "SVCCONFIG_BASE_URL",
    "SVCCONFIG_LKG_PATH",
  ],

  // repoEnvFallback + startSvcconfig use sane defaults from bootstrapService
});
