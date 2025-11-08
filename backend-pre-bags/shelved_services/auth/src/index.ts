// backend/services/auth/src/index.ts
/**
 * NowVibin (NV)
 * File: backend/services/auth/src/index.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 — Auth Service Skeleton (no minting)
 *   - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 *
 * Purpose:
 * - Start the Auth service using the shared async lifecycle.
 * - `ServiceEntrypoint` awaits `app.boot()` BEFORE exposing the HTTP handler.
 *
 * Invariants:
 * - Orchestration-only; no business logic here.
 * - No literals or env fallbacks; Bootstrap resolves PORT/envs.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { AuthApp } from "./app";

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({ service: "auth" });
  // Return the BootableApp; entrypoint will await app.boot() internally.
  await entry.run(() => new AuthApp());
}

main().catch((err) => {
  const log = getLogger().bind({ service: "auth", component: "bootstrap" });
  try {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    log.error({ err: e }, "auth boot_failed");
  } catch {
    // eslint-disable-next-line no-console
    console.error("fatal auth startup", err);
  }
  process.exit(1);
});
