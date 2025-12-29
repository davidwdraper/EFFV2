// backend/services/svcconfig/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Pure orchestration entrypoint for the svcconfig service.
 * - Delegates boot to shared runServiceEntrypoint() rails.
 */

import createApp from "./app";
import { runServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";

const SERVICE_SLUG = "svcconfig";
const SERVICE_VERSION = 1;

// eslint-disable-next-line no-console
console.info("[!!!!!boot check] env snapshot", {
  service: "svcconfig",
  NV_ENV: process.env.NV_ENV,
  NV_ENV_SERVICE_URL: process.env.NV_ENV_SERVICE_URL,
});

void runServiceEntrypoint({
  slug: SERVICE_SLUG,
  version: SERVICE_VERSION,

  // ADR-0084: posture is the single source of truth for boot rails.
  // svcconfig is DB-backed -> posture "db". (No checkDb flag.)
  posture: "db",

  // logFileBasename is optional; will default to "svcconfig-startup-error.log"
  createApp,
});
