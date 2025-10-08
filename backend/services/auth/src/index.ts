// backend/services/auth/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - Bootstrap the Auth service using shared Bootstrap and start HTTP server.
 * - On failure, log via standard logger (not console JSON).
 */

import { Bootstrap } from "@nv/shared/bootstrap/Bootstrap";
import { getLogger } from "@nv/shared/logger/Logger";
import { AuthApp } from "./app";

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

async function main(): Promise<void> {
  const boot = new Bootstrap({ service: "auth" });
  await boot.run(() => new AuthApp().instance);
}

main().catch((err) => {
  // Use standard logger so failures look like the rest of the system
  const log = getLogger().bind({ service: "auth" });
  log.error({ err: serializeError(err) }, "boot_failed");
  process.exit(1);
});
