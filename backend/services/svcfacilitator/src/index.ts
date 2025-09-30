// backend/services/svcfacilitator/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0002-svcfacilitator-minimal.md
 *
 * Purpose:
 * - Bootstrap via shared Bootstrap and start HTTP server.
 */

import { Bootstrap } from "@nv/shared";
import { SvcFacilitatorApp } from "./app";

async function main(): Promise<void> {
  await new Bootstrap({
    service: "svcfacilitator",
  }).run(() => new SvcFacilitatorApp().instance);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: 50,
      service: "svcfacilitator",
      msg: "boot_failed",
      err: String(err),
    })
  );
  process.exit(1);
});
