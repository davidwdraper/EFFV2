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
 * - **Retry policy lives here**: transient errors are retried; non-retryable
 *   (schema/contract) errors are quarantined (dropped from memory) so cadence
 *   doesn’t spin endlessly. App code stays clean.
 */

import type { AuditBlob } from "../contracts/audit/audit.blob.contract";
import type { IWalEngine } from "./IWalEngine";
import type { IWalJournal } from "./IWalJournal";
import type { IAuditWriter } from "./writer/IAuditWriter";

type WalLine = {
  appendedAt: number; // epoch ms when appended to WAL
  blob: AuditBlob;
};

function classifyError(err: any): "retryable" | "nonretryable" | "unknown" {
  const code = (err?.code ?? "").toString();

  // Non-retryable: contract/schema violations or explicit blob-invalid codes
  const nonRetryableCodes = new Set([
    "AUDIT_BLOB_INVALID",
    "BLOB_INVALID",
    "BLOB_INVALID_SERVICE",
    "BLOB_INVALID_TS",
    "BLOB_INVALID_REQUEST_ID",
    "WRITER_BAD_INPUT",
  ]);

  if (nonRetryableCodes.has(code)) return "nonretryable";

  // Retryable: DB/network classes
  const retryableCodes = new Set([
    "DB_CONNECT_FAILED",
    "DB_COLLECTION_FAILED",
    "DB_INSERT_FAILED",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "WRITER_TRANSIENT",
  ]);
  if (retryableCodes.has(code)) return "retryable";

  // Fallback classification by message heuristics (light-touch)
  const msg = (err?.message ?? "").toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("temporar") ||
    msg.includes("network") ||
    msg.includes("failed to connect")
  ) {
    return "retryable";
  }

  return "unknown";
}

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
        // Fast path: persist the whole batch
        await this.writer.writeBatch(batch);
        this.queue.splice(0, batch.length);
        return { accepted: batch.length };
      } catch (err) {
        const cls = classifyError(err);

        // Transient / unknown → let caller see the failure (will retry later)
        if (cls === "retryable" || cls === "unknown") {
          const e = new Error(
            `WAL writer_persist_failed: ${
              (err as Error)?.message || String(err)
            }`
          );
          (e as any).code = "WAL_PERSIST_FAILED";
          throw e;
        }

        // Non-retryable: isolate offenders so cadence doesn't spin forever.
        // We attempt per-item writes: good items persist, bad ones are dropped.
        let accepted = 0;
        const survivors: AuditBlob[] = [];

        for (const item of batch) {
          try {
            await this.writer.writeBatch([item]);
            accepted += 1; // persisted
          } catch (itemErr) {
            const itemCls = classifyError(itemErr);
            if (itemCls === "retryable" || itemCls === "unknown") {
              // Keep retrying this one later; don't lose it.
              survivors.push(item);
            } else {
              // Non-retryable: drop it from memory so we can make forward progress.
              // (Journal remains append-only — durability is preserved; operator can replay/inspect offline.)
              // Intentionally no throw here to avoid loops; first error already surfaced above.
            }
          }
        }

        // Replace queue with survivors
        this.queue.splice(0, batch.length, ...survivors);

        // Report the number that made it through now (and avoid further spam)
        return { accepted };
      }
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
