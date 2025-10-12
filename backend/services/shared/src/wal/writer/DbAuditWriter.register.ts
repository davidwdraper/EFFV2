// backend/services/shared/src/wal/writer/DbAuditWriter.register.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *   - adr0026-dbauditwriter-and-fifo-schema
 *
 * Purpose:
 * - Side-effect registration of the DbAuditWriter under the stable name "db".
 * - Allows AuditApp (or test harnesses) to dynamically import this file via:
 *     await import(process.env.AUDIT_WRITER_REGISTER)
 *   ...to register the writer without hardcoding it in the app.
 *
 * Notes:
 * - No barrels or shims.
 * - No environment reads or conditional logic.
 */

import { registerWriter } from "./WriterRegistry";
import { DbAuditWriter } from "./DbAuditWriter";

/** Stable, canonical writer name */
const WRITER_NAME = "db";

/** Register factory under the stable name. */
registerWriter(WRITER_NAME, () => new DbAuditWriter(), {
  description: "MongoDB-backed FIFO writer for Audit WAL",
  version: 1,
});

/**
 * Optional async default export (for dynamic import compatibility).
 * Calling code may `await import(...)` to trigger registration.
 */
export default async function register(): Promise<void> {
  // no-op; side-effect already executed above
}
