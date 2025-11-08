// backend/services/shared/src/writer/IAuditWriter.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Destination-agnostic writer interface for flushing WAL records.
 * - Implementations: MockAuditWriter (initial), DbAuditWriter, HttpAuditWriter, ZeroGWriter, etc.
 *
 * Contract:
 * - `writeBatch` MUST be idempotent or harmlessly deduplicate; WAL replay can resend items.
 * - Throw on failure (no silent fallbacks). WAL will retain items for later replay.
 */

import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";

export interface IAuditWriter {
  /**
   * Persist a batch of audit blobs to the destination.
   * MUST reject on failure. MUST be safe to call again with the same batch.
   */
  writeBatch(batch: ReadonlyArray<AuditBlob>): Promise<void>;
}
