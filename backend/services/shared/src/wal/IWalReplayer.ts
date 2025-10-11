// backend/services/shared/src/wal/IWalReplayer.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Lean interface for WAL crash/recovery replay.
 * - Reads journaled lines and re-emits canonical `AuditBlob`s to a writer.
 *
 * Design:
 * - Destination-agnostic; no DB/HTTP assumptions.
 * - Idempotency is owned by the writer/destination (safe to resend).
 * - Cursor strategy is implementation-defined (cursorless default OK).
 *
 * Notes:
 * - No environment reads here; impls get all config via ctor.
 * - Keep this tiny; implementations can add diagnostics via their own methods.
 */

import type { AuditBlob } from "../contracts/audit/audit.blob.contract";
import type { IAuditWriter } from "./writer/IAuditWriter";

export type ReplayStats = Readonly<{
  filesScanned: number;
  linesScanned: number;
  batchesEmitted: number;
  blobsReplayed: number;
}>;

export interface IWalReplayer {
  /**
   * Scan WAL journals and send recovered blobs to the provided writer in batches.
   * Implementations decide batch sizing and cursor strategy.
   *
   * MUST reject on unrecoverable I/O errors. Individual bad lines may be skipped
   * with diagnostics, but the implementation should be explicit in its policy.
   */
  replay(writer: IAuditWriter): Promise<ReplayStats>;

  /**
   * Optional: a one-shot helper that returns the next batch of `AuditBlob`s
   * from the journal for callers that want fine-grained control.
   */
  nextBatch?(): Promise<ReadonlyArray<AuditBlob>>;
}
