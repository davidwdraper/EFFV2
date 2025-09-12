// backend/services/audit/src/bootstrap/bootstrap.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0003-shared-app-builder.md
 *
 * Why:
 * - Load envs via the shared cascade (repo → family → service), then assert
 *   required vars. No custom loaders, no local options.
 *
 * Notes:
 * - Index.ts still controls DB connect, WAL replay, HTTP start. This file only
 *   loads/validates env and sets the service identity.
 */

import path from "path";
import { loadEnvCascadeForService, assertEnv } from "@eff/shared/src/env";

// Service identity (used by logs and elsewhere)
export const SERVICE_NAME = "audit";

// Service root for env cascade: /backend/services/audit/src → service root is one up
const serviceRootAbs = path.resolve(__dirname, "..");

// 1) Load envs in the shared cascade (later files override earlier ones)
loadEnvCascadeForService(serviceRootAbs);

// 2) Validate required envs early (fail fast)
assertEnv([
  "AUDIT_PORT",
  "AUDIT_MONGO_URI",
  // S2S required for internal-only services
  "S2S_JWT_SECRET",
  // audience/issuers can be configured via lists; audience is still required
  "S2S_JWT_AUDIENCE",
]);

// This module has no exports beyond SERVICE_NAME; its side-effect is env loading.
