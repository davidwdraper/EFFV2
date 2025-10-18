// backend/services/gateway/src/index.ts
/**
 * NowVibin (NV)
 * File: backend/services/gateway/src/index.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0001 — Gateway-Embedded SvcConfig Mirror
 * - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 *
 * Purpose:
 * - Start the Gateway service using the shared async lifecycle.
 * - `ServiceEntrypoint` awaits `app.boot()` BEFORE exposing the HTTP handler.
 * - GatewayApp warms its own SvcConfig; no internals wired here.
 *
 * Invariants:
 * - No literals, no env fallbacks here; `Bootstrap` resolves PORT.
 * - Orchestration-only; zero business logic in this file.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { GatewayApp } from "./app";

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({ service: "gateway" });
  // Return the BootableApp; entrypoint will await app.boot() internally.
  await entry.run(() => new GatewayApp());
}

main().catch((err) => {
  const log = getLogger().bind({ service: "gateway", component: "bootstrap" });
  try {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    log.error({ err: e }, "gateway boot_failed");
  } catch {
    // Failsafe if logger can't materialize
    // eslint-disable-next-line no-console
    console.error("fatal gateway startup", err);
  }
  process.exit(1);
});
