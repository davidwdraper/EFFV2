// backend/services/jwks/src/index.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/index.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 *   - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Orchestration-only bootstrap for the JWKS service.
 *
 * Invariants:
 * - No literals or env fallbacks here; the AppBase/Bootstrap layer resolves ports/envs.
 * - Single concern: construct ServiceEntrypoint and run JwksApp.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { JwksApp } from "./app";

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({ service: "jwks" });
  // Return a BootableApp; the entrypoint will call app.boot() internally.
  await entry.run(() => new JwksApp());
}

main().catch((err) => {
  const log = getLogger().bind({ service: "jwks", component: "bootstrap" });
  try {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    log.error({ err: e }, "jwks boot_failed");
  } catch {
    // eslint-disable-next-line no-console
    console.error("fatal jwks startup", err);
  }
  process.exit(1);
});
