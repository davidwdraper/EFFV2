// backend/services/audit/index.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/index.ts
 * Service Slug: audit
 *
 * Why:
 *   Standardize boot using shared `bootstrapService` so Mongo is connected and
 *   the Audit WAL is replayed **before** the HTTP server binds its port.
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

  requiredEnv: [
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    "AUDIT_MONGO_URI",
    "S2S_JWT_AUDIENCE",
    "SVCCONFIG_BASE_URL",
    "SVCCONFIG_LKG_PATH",
  ],

  // Keep strict: repo fallback stays OFF unless you explicitly set repoEnvFallback: true
});
