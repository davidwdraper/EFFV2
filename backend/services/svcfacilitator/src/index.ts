// backend/services/svcfacilitator/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint vs ServiceBase)
 *
 * Purpose:
 * - Composition-root entrypoint using shared ServiceEntrypoint (no inheritance).
 * - Pre-start hydrates the svcconfig mirror (DB → LKG fallback).
 * - No console.* — all logs via shared structured logger.
 */

import path from "path";
process.env.SERVICE_CWD = path.resolve(__dirname, "..");

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { SvcFacilitatorApp } from "./app";
import { preStartHydrateMirror } from "./boot/boot.hydrate";

const SERVICE = "svcfacilitator";
const VERSION = 1;

async function main() {
  const entry = new ServiceEntrypoint({
    service: SERVICE,
    logVersion: VERSION,
    // PORT is read via Bootstrap (PORT env var per SOP)
    preStart: async () => {
      // hydrate mirror before listening
      await preStartHydrateMirror();
    },
  });

  await entry.run(() => new SvcFacilitatorApp().instance);
}

main().catch((err) => {
  // Safe fallback: structured logger (falls back to console if root not set yet)
  const log = getLogger().bind({
    slug: SERVICE,
    version: VERSION,
    url: "/main",
  });
  log.error({ err: String(err) }, "boot_failed");
  process.exit(1);
});
