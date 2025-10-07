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
 *   - ADR-0020 (SvcConfig Mirror & Push Design)
 *
 * Purpose:
 * - Composition-root entrypoint using shared ServiceEntrypoint (no inheritance).
 * - Pre-start hydrates the svcconfig mirror (DB → LKG fallback).
 * - Immediately after hydration, run a LOUD audit comparing DB vs mirror counts
 *   and reasons (disabled, proxying disabled, invalid schema).
 */

import path from "path";
process.env.SERVICE_CWD = path.resolve(__dirname, "..");

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { SvcFacilitatorApp } from "./app";
import { preStartHydrateMirror } from "./boot/boot.hydrate";
import { auditMirrorVsDb } from "./services/mirror.audit";

const SERVICE = "svcfacilitator";
const VERSION = 1;

async function main() {
  const entry = new ServiceEntrypoint({
    service: SERVICE,
    logVersion: VERSION,
    preStart: async () => {
      await preStartHydrateMirror();
      // Loud, non-fatal audit; logs INFO summary and WARN on mismatch.
      await auditMirrorVsDb();
    },
  });

  await entry.run(() => new SvcFacilitatorApp().instance);
}

main().catch((err) => {
  const log = getLogger().bind({
    slug: SERVICE,
    version: VERSION,
    url: "/main",
  });
  log.error({ err: String(err) }, "boot_failed");
  process.exit(1);
});
