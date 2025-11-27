// backend/services/svcconfig/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *
 * Purpose:
 * - Pure orchestration entrypoint for the svcconfig service.
 * - Delegates boot to shared runServiceEntrypoint() rails.
 */

import createApp from "./app";
import { runServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";

const SERVICE_SLUG = "svcconfig";
const SERVICE_VERSION = 1;

void runServiceEntrypoint({
  slug: SERVICE_SLUG,
  version: SERVICE_VERSION,
  checkDb: true,
  // logFileBasename is optional; will default to "svcconfig-startup-error.log"
  createApp,
});
