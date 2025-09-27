// backend/services/auth/index.ts

/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0003-shared-app-builder.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Standardize boot with shared `bootstrapService`. Auth has no DB; we just
 *   ensure env is valid, build the app lazily, and bind the port.
 */

import "tsconfig-paths/register";
import path from "node:path";
import { bootstrapService } from "@eff/shared/src/bootstrap/bootstrapService";

const SERVICE_NAME = "auth" as const;

void bootstrapService({
  serviceName: SERVICE_NAME,
  serviceRootAbs: path.resolve(__dirname), // this folder (not /src)
  createApp: () => {
    // Lazy import so env cascade is applied before app/config loads
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./src/app");
    return mod.default;
  },
  portEnv: "AUTH_PORT",
  requiredEnv: [
    // logging
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    // S2S plane (internal services)
    "S2S_JWT_AUDIENCE",
    // upstream wiring for user (slug & paths kept as envs per SOP)
    "USER_SLUG", // e.g., "user"
    "USER_SLUG_API_VERSION", // e.g., "v1" (currently unused but reserved)
    "USER_ROUTE_USERS", // e.g., "/users"
    "USER_ROUTE_PRIVATE_EMAIL", // e.g., "/users/private/email"
  ],
});
