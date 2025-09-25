// backend/services/geo/index.ts

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
 * - Standardize boot with shared `bootstrapService`: env cascade (+ non-prod repo root fallback),
 *   logger init, then start HTTP. Geo has no DB, so no beforeStart hook needed.
 *
 * Notes:
 * - `serviceRootAbs` is the service root (this folder), not /src.
 * - Geo is internal-only; verifyS2S is mounted inside app.ts.
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/bootstrap/bootstrapService";

const SERVICE_NAME = "geo" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname), // ← service root
  createApp: () => {
    // Lazy import so env cascade is applied before app/config loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },
  portEnv: "GEO_PORT",
  requiredEnv: [
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    // Internal S2S plane for inbound verification
    "S2S_JWT_AUDIENCE",
  ],
  // repoEnvFallback + startSvcconfig use sane defaults from bootstrapService
});
