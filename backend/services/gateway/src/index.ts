// backend/services/gateway/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *   - ADR-#### (AppBase Optional DTO Registry for Proxy Services)
 *
 * Purpose:
 * - Gateway service entrypoint.
 * - Gateway is a pure proxy: no DB, no registry, no index ensure.
 */

import createApp from "./app";
import { runServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";

const SERVICE_SLUG = "gateway";
const SERVICE_VERSION = 1;

void runServiceEntrypoint({
  slug: SERVICE_SLUG,
  version: SERVICE_VERSION,
  checkDb: false,
  createApp,
});
