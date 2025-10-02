// backend/services/user/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Bootstrap the User service using shared Bootstrap and start HTTP server.
 */

import { Bootstrap } from "@nv/shared/bootstrap/Bootstrap";
import { UserApp } from "./app";

async function main(): Promise<void> {
  await new Bootstrap({ service: "user" }).run(() => new UserApp().instance);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: 50,
      service: "user",
      msg: "boot_failed",
      err: String(err),
    })
  );
  process.exit(1);
});
