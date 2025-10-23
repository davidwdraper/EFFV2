// backend/services/svcfacilitator/src/index.ts
/**
 * NowVibin (NV)
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0002 — SvcFacilitator Minimal (bootstrap & purpose)
 * - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 * - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *
 * Purpose:
 * - Thin entrypoint. Delegates to bootstrap.v2.ts/main(), which:
 *   1) Builds deps (async)
 *   2) Calls ServiceEntrypoint.run() with a *synchronous* RequestListener
 *
 * Invariants:
 * - Orchestration-only; zero business logic here.
 * - No literals, no env fallbacks here.
 */

import { getLogger } from "@nv/shared/logger/Logger";
import { main as bootstrapMain } from "./bootstrap.v2";

(async () => {
  try {
    await bootstrapMain();
  } catch (err) {
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
      // eslint-disable-next-line no-console
      console.error("fatal svcfacilitator startup", err);
    }
    process.exit(1);
  }
})();
