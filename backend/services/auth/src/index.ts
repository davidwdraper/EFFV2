// backend/services/auth/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - Bootstrap the Auth service using shared Bootstrap and start HTTP server.
 */

import { Bootstrap } from "@nv/shared/bootstrap/Bootstrap";
import { AuthApp } from "./app";

async function main(): Promise<void> {
  await new Bootstrap({
    service: "auth",
  }).run(() => new AuthApp().instance);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: 50,
      service: "auth",
      msg: "boot_failed",
      err: String(err),
    })
  );
  process.exit(1);
});
