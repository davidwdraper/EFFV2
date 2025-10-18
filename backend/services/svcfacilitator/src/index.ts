// backend/services/svcfacilitator/src/index.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/index.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys, OO form)
 *   - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *   - ADR-0013 — Versioned Health Envelope & Routes
 *   - ADR-0014 — Base Hierarchy (ServiceEntrypoint vs ServiceBase)
 *   - ADR-0020 — SvcConfig Mirror & Push Design
 *
 * Purpose:
 * - Composition-root entrypoint using shared ServiceEntrypoint (async lifecycle).
 * - Pre-start hydrates the svcconfig mirror (DB → LKG fallback).
 * - After hydration, emit a LOUD audit comparing DB vs mirror counts and reasons.
 *
 * Invariants:
 * - No env literals; Bootstrap resolves PORT/envs.
 * - Orchestration-only; no business logic here.
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

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({
    service: SERVICE,
    logVersion: VERSION,
    preStart: async () => {
      await preStartHydrateMirror();
      // Loud, non-fatal audit; logs INFO summary and WARN on mismatch.
      await auditMirrorVsDb();
    },
  });

  // Return the BootableApp; entrypoint awaits app.boot() before listen.
  await entry.run(() => new SvcFacilitatorApp());
}

main().catch((err) => {
  const log = getLogger().bind({
    service: SERVICE,
    component: "bootstrap",
    version: VERSION,
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
});
