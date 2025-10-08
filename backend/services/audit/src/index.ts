// backend/services/audit/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Bootstrap the Audit service using shared Bootstrap and start HTTP server.
 * - Environment-invariant: service slug is fixed ("audit"); ports/hosts come from env.
 */

import { Bootstrap } from "@nv/shared/bootstrap/Bootstrap";
import { AuditApp } from "./app";

async function main(): Promise<void> {
  await new Bootstrap({ service: "audit" }).run(() => new AuditApp().instance);
}

main().catch((err) => {
  // NOTE: service name should ultimately come from env/config too
  console.error(
    JSON.stringify({
      level: 50,
      service: "audit",
      msg: "boot_failed",
      err: String(err),
    })
  );
  process.exit(1);
});
