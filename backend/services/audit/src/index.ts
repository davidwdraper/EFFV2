// backend/services/audit/src/index.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0025 (Audit WAL with Opaque Payloads & Writer Injection)
 *
 * Purpose (stub phase):
 * - Bootstrap the Audit service using shared Bootstrap and start HTTP server.
 * - No WAL/DB/S2S yet — just a dumb listener for smoke tests.
 *
 * Notes:
 * - Health is mounted by AppBase under /api/audit/v1/health/*.
 * - Future S2S will be handled in shared SvcReceiver; this file will not change.
 */

import { Bootstrap } from "@nv/shared/bootstrap/Bootstrap";
import { getLogger } from "@nv/shared/logger/Logger";
import { AuditApp } from "./app";

async function main(): Promise<void> {
  const boot = new Bootstrap({ service: "audit" });
  await boot.run(() => new AuditApp().instance);
}

main().catch((err) => {
  // Structured logger; matches system-wide format
  const log = getLogger().bind({ service: "audit", component: "bootstrap" });
  try {
    const errObj =
      typeof (log as any).serializeError === "function"
        ? (log as any).serializeError(err)
        : { message: String(err), stack: (err as any)?.stack };

    log.error({ err: errObj }, "audit boot_failed");
  } catch {
    // Failsafe: only if logger cannot materialize
    // eslint-disable-next-line no-console
    console.error("fatal audit startup", err);
  }
  process.exit(1);
});
