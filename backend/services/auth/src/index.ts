// backend/services/auth/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose (template):
 * - Pure orchestration entrypoint for a CRUD-style auth service.
 * - Delegates config loading + runtime construction to envBootstrap() via ServiceEntrypoint.
 * - Declares identity + posture only; avoids per-service bootstrap drift.
 *
 * Invariants:
 * - No process.env reads here (bootstrap owns it).
 * - Posture is the single source of truth (no checkDb duplication).
 * - No EnvServiceDto unwrapping logic in service code (shared entrypoint owns it).
 */

import { runServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";
import createApp from "./app";

// ———————————————————————————————————————————————————————————————
// Service identity
// ———————————————————————————————————————————————————————————————
const SERVICE_SLUG = "auth";
const SERVICE_VERSION = 1;

// Template posture: CRUD entity services are DB owners.
const POSTURE: SvcPosture = "mos";

(async () => {
  await runServiceEntrypoint({
    slug: SERVICE_SLUG,
    version: SERVICE_VERSION,
    posture: POSTURE,
    createApp,
  });
})();
