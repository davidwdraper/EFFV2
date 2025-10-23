// backend/services/svcfacilitator/src/index.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/index.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0002 — SvcFacilitator Minimal (bootstrap & purpose)
 * - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 * - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *
 * Purpose:
 * - Start the SvcFacilitator service using the shared async lifecycle.
 * - `ServiceEntrypoint` awaits `app.boot()` BEFORE exposing the HTTP handler.
 * - All wiring lives in bootstrap.v2.ts; no internals wired here.
 *
 * Invariants:
 * - No literals, no env fallbacks here; shared bootstrap resolves ports/envs.
 * - Orchestration-only; zero business logic in this file.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { createSvcFacilitatorApp } from "./bootstrap.v2";

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({ service: "svcfacilitator" });
  // Return the BootableApp; entrypoint will await app.boot() internally.
  await entry.run(() => createSvcFacilitatorApp());
}

main().catch((err) => {
  const log = getLogger().bind({
    service: "svcfacilitator",
    component: "bootstrap",
  });
  try {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    log.error({ err: e }, "svcfacilitator boot_failed");
  } catch {
    // Failsafe if logger can't materialize
    // eslint-disable-next-line no-console
    console.error("fatal svcfacilitator startup", err);
  }
  process.exit(1);
});
