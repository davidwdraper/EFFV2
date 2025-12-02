// backend/services/user-auth/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *
 * Purpose (template):
 * - Generic CRUD-style service entrypoint.
 * - Cloned for concrete services; slug/name are replaced by the cloner.
 */

import createApp from "./app";
import { runServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";

const SERVICE_SLUG = "user-auth";
const SERVICE_VERSION = 1;

void runServiceEntrypoint({
  slug: SERVICE_SLUG,
  version: SERVICE_VERSION,
  checkDb: true,
  createApp,
});
