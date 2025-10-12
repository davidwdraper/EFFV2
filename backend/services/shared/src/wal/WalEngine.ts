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
 * Notes:
 * - No environment literals. No timers here. Callers decide cadence.
 */

import type { AuditBlob } from "../contracts/audit/audit.blob.contract";
import type { IWalEngine } from "./IWalEngine";
import type { IWalJournal } from "./IWalJournal";
import type { IAuditWriter } from "./writer/IAuditWriter";

type WalLine = {
  appendedAt: number; // epoch ms when appended to WAL
  blob: AuditBlob;
};

export class WalEngine implements IWalEngine {
  private readonly journal: IWalJournal;
  private writer: IAuditWriter;
  private readonly queue: AuditBlob[] = [];
  private draining = false;

  constructor(journal: IWalJournal, writer: IAuditWriter) {
    this.journal = journal;
    this.writer = writer;
  }

  public setWriter(next: IAuditWriter): void {
    this.writer = next;
  }

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

    this.queue.push(blob);
  }

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

  public async flush(): Promise<{ accepted: number }> {
    if (this.draining) return { accepted: 0 };
    if (this.queue.length === 0) return { accepted: 0 };

    this.draining = true;
    try {
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

      this.queue.splice(0, batch.length);
      return { accepted: batch.length };
    } finally {
      this.draining = false;
    }
  }

  /** Explicit shutdown for file handles, etc. */
  public async close(): Promise<void> {
    const j: any = this.journal as any;
    if (j && typeof j.close === "function") {
      await j.close();
    }
  }
}
