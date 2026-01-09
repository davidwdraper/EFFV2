// backend/services/test-runner/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose (template):
 * - Pure orchestration entrypoint for a CRUD-style test-runner service.
 * - Delegates config loading + runtime construction to envBootstrap() via ServiceEntrypoint.
 * - Declares identity + posture only; avoids per-service bootstrap drift.
 *
 * Invariants:
 * - No process.env reads here (bootstrap owns it).
 * - Posture is the single source of truth (no checkDb duplication).
 * - No DbEnvServiceDto unwrapping logic in service code (shared entrypoint owns it).
 *
 * Template/test-runner invariant:
 * - POSTURE must be exported from src/app.ts so dist/app.js exposes it for the runner.
 * - This file must import POSTURE from app.ts to avoid posture drift.
 */

import { runServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import createApp, { POSTURE } from "./app";

// ———————————————————————————————————————————————————————————————
// Service identity
// ———————————————————————————————————————————————————————————————
const SERVICE_SLUG = "test-runner";
const SERVICE_VERSION = 1;

(async () => {
  await runServiceEntrypoint({
    slug: SERVICE_SLUG,
    version: SERVICE_VERSION,
    posture: POSTURE,
    createApp,
  });
})();
