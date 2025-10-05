// backend/services/svcfacilitator/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *   - ADR-0009 (ServiceBase — class-based service entrypoint)
 *   - ADR-0008 (SvcFacilitator LKG — boot resilience when DB is down)
 *
 * Purpose:
 * - Class-based entrypoint using shared ServiceBase to eliminate drift.
 * - Pre-start hydrates svcconfig mirror (DB → LKG fallback).
 * - All logs via shared logger (no console.*).
 */

import path from "path";
process.env.SERVICE_CWD = path.resolve(__dirname, "..");

import { ServiceBase } from "@nv/shared/bootstrap/ServiceBase";
import { getLogger } from "@nv/shared/util/logger.provider";
import { SvcFacilitatorApp } from "./app";
import { preStartHydrateMirror } from "./boot/boot.hydrate";

class Main extends ServiceBase {
  protected override async preStart(): Promise<void> {
    await preStartHydrateMirror();
  }

  protected override buildApp() {
    return new SvcFacilitatorApp().instance;
  }
}

new Main("svcfacilitator", { logVersion: 1 }).run().catch((err) => {
  const log = getLogger().bind({
    slug: "svcfacilitator",
    version: 1,
    url: "/main",
  });
  log.error(`boot_failed - ${String(err)}`);
  process.exit(1);
});
