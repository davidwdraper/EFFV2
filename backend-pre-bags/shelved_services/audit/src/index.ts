// backend/services/audit/src/index.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0025 (Audit WAL with Opaque Payloads & Writer Injection)
 *
 * Purpose:
 * - Bootstrap the Audit service using shared ServiceEntrypoint (async lifecycle).
 * - Ensures durable deps (WAL) are ready BEFORE exposing the HTTP handler.
 */

import { ServiceEntrypoint } from "@nv/shared/bootstrap/ServiceEntrypoint";
import { getLogger } from "@nv/shared/logger/Logger";
import { AuditApp } from "./app";

async function main(): Promise<void> {
  const entry = new ServiceEntrypoint({ service: "audit" });

  // Preferred contract: return a BootableApp (AuditApp), not a bare handler.
  await entry.run(() => new AuditApp());
}

main().catch((err) => {
  const log = getLogger().bind({ service: "audit", component: "bootstrap" });
  try {
    const errObj =
      typeof (log as any).serializeError === "function"
        ? (log as any).serializeError(err)
        : { message: String(err), stack: (err as any)?.stack };

    log.error({ err: errObj }, "audit boot_failed");
  } catch {
    // eslint-disable-next-line no-console
    console.error("fatal audit startup", err);
  }
  process.exit(1);
});
