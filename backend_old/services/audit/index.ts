/**
 * NowVibin — Backend
 * File: backend/services/audit/index.ts
 * Service Slug: audit
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Why:
 *   Standardize boot using shared `bootstrapService` so Mongo is connected and
 *   the Audit WAL is replayed **before** the HTTP server binds its port.
 *
 * Notes:
 *   Per ADR-0034, services no longer carry SVCCONFIG_* env. Discovery is
 *   centralized in the gateway. Each service knows only GATEWAY_INTERNAL_BASE_URL.
 */
import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

const SERVICE_NAME = "audit" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname),

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

  // Per ADR-0034, require gateway (internal) instead of svcconfig.
  requiredEnv: [
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    "AUDIT_MONGO_URI",
    "S2S_JWT_AUDIENCE",
    "GATEWAY_INTERNAL_BASE_URL",
  ],

  // Keep strict: repo fallback stays OFF unless explicitly enabled.
});
