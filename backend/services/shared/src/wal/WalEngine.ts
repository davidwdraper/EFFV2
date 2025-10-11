// backend/services/shared/src/wal/WalEngine.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Lean, durability-first WAL engine.
 * - Accepts canonical `AuditBlob`, journals each append synchronously,
 *   buffers in-memory, and flushes via an injected **IAuditWriter**.
 *
 * Design:
 * - Public API speaks ONLY `AuditBlob` (opaque to WAL).
 * - Journal format is internal; we record `{ appendedAt, blob }` as LDJSON.
 * - `append*` MUST throw on any journaling failure (no silent fallbacks).
 * - `flush()` delegates to the injected writer; WAL never knows destinations.
 *
 * Notes:
 * - No environment literals. No timers here. Callers decide cadence.
 * - Writers are provided by a factory elsewhere (e.g., MockAuditWriter first).
 */

import type { AuditBlob } from "../contracts/audit/audit.blob.contract";
import type { IWalEngine } from "./IWalEngine";
import type { IWalJournal } from "./IWalJournal";
import type { IAuditWriter } from "./writer/IAuditWriter";

// Internal-only envelope (never exported)
type WalLine = {
  appendedAt: number; // epoch ms when appended to WAL
  blob: AuditBlob;
};

export class WalEngine implements IWalEngine {
  private readonly journal: IWalJournal;
  private writer: IAuditWriter;
  private readonly queue: AuditBlob[] = [];
  private draining = false;

  /**
   * @param journal Durable line journal (fs-backed or equivalent).
   * @param writer  Destination-agnostic writer (mock/DB/HTTP/etc.).
   */
  constructor(journal: IWalJournal, writer: IAuditWriter) {
    this.journal = journal;
    this.writer = writer;
  }

  /** Optional: allow swapping writers at runtime (e.g., after a lease/renew). */
  public setWriter(next: IAuditWriter): void {
    this.writer = next;
  }

  /** Append a single blob and synchronously journal it (LDJSON line). */
  public append(blob: AuditBlob): void {
    const line: WalLine = { appendedAt: Date.now(), blob };
    let serialized: string;
    try {
      serialized = JSON.stringify(line);
    } catch (err) {
      const e = new Error(
        `WAL serialize_failed: ${(err as Error)?.message || String(err)}`
      );
      (e as any).code = "WAL_SERIALIZE_FAILED";
      throw e;
    }

    try {
      this.journal.append(serialized + "\n"); // ensure single line
    } catch (err) {
      const e = new Error(
        `WAL journal_append_failed: ${(err as Error)?.message || String(err)}`
      );
      (e as any).code = "WAL_APPEND_FAILED";
      throw e;
    }

    // Only enqueue after durable append succeeds
    this.queue.push(blob);
  }

  /** Multi-append with the same durability semantics as append(). */
  public appendBatch(blobs: ReadonlyArray<AuditBlob>): void {
    for (let i = 0; i < blobs.length; i++) {
      try {
        this.append(blobs[i] as AuditBlob);
      } catch (err) {
        const e = new Error(
          `WAL append_batch_failed at index ${i}: ${
            (err as Error)?.message || String(err)
          }`
        );
        (e as any).code = "WAL_BATCH_APPEND_FAILED";
        (e as any).index = i;
        throw e;
      }
    }
  }

  /**
   * Drain queued, already-journaled blobs to the injected writer.
   * Concurrency: if a flush is in progress, this call is a no-op `{accepted:0}`.
   */
  public async flush(): Promise<{ accepted: number }> {
    if (this.draining) return { accepted: 0 };
    if (this.queue.length === 0) return { accepted: 0 };

    this.draining = true;
    try {
      // Snapshot current queue so new appends aren’t blocked
      const batch = this.queue.slice(0);
      if (batch.length === 0) return { accepted: 0 };

      try {
        await this.writer.writeBatch(batch);
      } catch (err) {
        const e = new Error(
          `WAL writer_persist_failed: ${(err as Error)?.message || String(err)}`
        );
        (e as any).code = "WAL_PERSIST_FAILED";
        throw e;
      }

      // On success, remove exactly `batch.length` items from the front
      this.queue.splice(0, batch.length);
      return { accepted: batch.length };
    } finally {
      this.draining = false;
    }
  }
}
