// backend/services/audit/src/repo/audit.store.types.ts
/**
 * Purpose:
 * - Canonical store interface for the Audit service (append-only).
 * - No reads, no updates, no upserts. Inserts finalized records only.
 */

import type { AuditRecordJson } from "@nv/shared/contracts/audit/audit.record.contract";

export interface IAuditStore {
  /** Ensure required indexes (idempotent; safe to call at startup). */
  ensureIndexes(): Promise<void>;

  /**
   * Append-only bulk insert of finalized audit records.
   * - Duplicate requestIds MUST be silently ignored by the implementation.
   * - Returns number of successfully inserted docs (excludes dupes).
   */
  insertFinalMany(records: AuditRecordJson[]): Promise<number>;
}

// Helpful alias for clarity in call sites
export type { AuditRecordJson } from "@nv/shared/contracts/audit/audit.record.contract";
