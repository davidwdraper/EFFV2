// backend/services/user/src/index.ts
/**
 * NowVibin (NV)
 * File: backend/services/user/src/index.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *   - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 *
 * Purpose:
 * - Start the User service using the shared async lifecycle.
 * - `ServiceEntrypoint` awaits `app.boot()` BEFORE exposing the HTTP handler.
 *
 * Invariants:
 * - Orchestration-only; no business logic here.
 * - No env literals or fallbacks here; Bootstrap resolves PORT/envs.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { UserApp } from "./app";

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({ service: "user" });
  // Return the BootableApp; entrypoint will await app.boot() internally.
  await entry.run(() => new UserApp());
}

main().catch((err) => {
  const log = getLogger().bind({ service: "user", component: "bootstrap" });
  try {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    log.error({ err: e }, "user boot_failed");
  } catch {
    // eslint-disable-next-line no-console
    console.error("fatal user startup", err);
  }
  process.exit(1);
});
