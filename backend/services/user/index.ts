// backend/services/user/index.ts

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
 * - Standardize boot with shared `bootstrapService`: env cascade (+ safe repo-root fallback in non-prod),
 *   optional early svcconfig mirror, logger init, then start HTTP.
 * - Keeps user in lockstep with gateway/act boot flow.
 *
 * Notes:
 * - `serviceRootAbs` is the service root (this folder), not /src.
 * - `portEnv` is assumed to be USER_PORT; if your service uses a different name,
 *   update the value here to match your env contract.
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

const SERVICE_NAME = "user" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname), // ← service root
  createApp: () => {
    // Lazy import so env cascade is applied before app/config loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },
  portEnv: "USER_PORT",
  requiredEnv: [
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    // If user service needs DB or other hard requirements, add them here:
    // "USER_MONGO_URI",
    // "S2S_JWT_SECRET",
    // "S2S_JWT_AUDIENCE",
  ],
  // repoEnvFallback + startSvcconfig are enabled by default inside bootstrapService
});
