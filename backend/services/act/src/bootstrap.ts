// backend/services/act/src/bootstrap.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/MICROSERVICES.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Load envs via the shared cascade (repo → family → service) and assert
 *   the minimum required variables for an internal-only entity service.
 */

import { loadEnvCascadeForService, assertEnv } from "@eff/shared/src/env";

export const SERVICE_NAME = "act" as const;

// 1) Shared env cascade (later wins)
loadEnvCascadeForService(__dirname);

// 2) Fail fast on required envs
assertEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "ACT_MONGO_URI",
  "ACT_PORT",
  // internal-only S2S plane
  "S2S_JWT_SECRET",
  "S2S_JWT_AUDIENCE",
]);

// Optional visibility for S2S config
console.log(
  `[${SERVICE_NAME}] S2S plane: iss=%s aud=%s`,
  process.env.S2S_JWT_ISSUER,
  process.env.S2S_JWT_AUDIENCE
);
