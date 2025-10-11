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

async function main(): Promise<void> {
  const boot = new Bootstrap({ service: "auth" });
  await boot.run(() => new AuthApp().instance);
}

main().catch((err) => {
  // Structured logger; matches the rest of the system
  const log = getLogger().bind({ service: "auth", component: "bootstrap" });
  try {
    // Prefer structured error payload if available
    const errObj =
      typeof (log as any).serializeError === "function"
        ? (log as any).serializeError(err)
        : { message: String(err), stack: (err as any)?.stack };

    log.error({ err: errObj }, "auth boot_failed");
  } catch {
    // Last-resort fallback only if logger cannot materialize
    // (kept intentionally terse to avoid console noise in normal operation)
    // eslint-disable-next-line no-console
    console.error("fatal auth startup", err);
  }
  process.exit(1);
});
