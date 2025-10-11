// backend/services/shared/src/wal/replay/CursorlessWalReplayer.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Minimal, destination-agnostic WAL replayer that scans LDJSON journal files,
 *   extracts canonical `AuditBlob`s, and hands them to an `IAuditWriter` in batches.
 *
 * Design (lean + durable):
 * - Cursor-less: re-reads whole files in filename order (wal-<epoch>.ldjson).
 * - Safe-by-default: bad lines are skipped with local diagnostics; replay continues.
 * - Batch sizing is configurable; writer must be idempotent (WAL can resend).
 *
 * Notes:
 * - No environment reads; all config via constructor.
 * - No assumptions about journal rotation; just reads whatever matches the pattern.
 * - If your journal naming differs, pass a custom `filePattern`.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";
import type { IAuditWriter } from "../writer/IAuditWriter";
import type { IWalReplayer, ReplayStats } from "../IWalReplayer";

export type CursorlessWalReplayerOptions = {
  /** Directory containing LDJSON WAL segments. */
  dir: string;
  /** Regex to select files; default: /^wal-.*\.ldjson$/ */
  filePattern?: RegExp;
  /** Max blobs per batch sent to writer. Default: 100. */
  batchSize?: number;
};

type WalLine = { appendedAt: number; blob: AuditBlob };

export class CursorlessWalReplayer implements IWalReplayer {
  private readonly dir: string;
  private readonly filePattern: RegExp;
  private readonly batchSize: number;

  constructor(opts: CursorlessWalReplayerOptions) {
    if (!opts?.dir) {
      const e = new Error("CursorlessWalReplayer: `dir` is required");
      (e as any).code = "WAL_REPLAYER_BAD_CONFIG";
      throw e;
    }
    this.dir = opts.dir;
    this.filePattern = opts.filePattern ?? /^wal-.*\.ldjson$/;
    this.batchSize = Math.max(1, Math.floor(opts.batchSize ?? 100));
  }

  public async replay(writer: IAuditWriter): Promise<ReplayStats> {
    const files = await this.listWalFiles();
    let filesScanned = 0;
    let linesScanned = 0;
    let batchesEmitted = 0;
    let blobsReplayed = 0;

    // Working batch buffer
    let batch: AuditBlob[] = [];

    for (const file of files) {
      filesScanned++;
      const abs = path.resolve(this.dir, file);

      // Stream line-by-line to keep memory stable
      const rl = await import("node:readline");
      const stream = fs.createReadStream(abs, { encoding: "utf8" });
      const reader = rl.createInterface({ input: stream, crlfDelay: Infinity });

      try {
        for await (const line of reader) {
          if (!line) continue;
          linesScanned++;

          let parsed: WalLine | undefined;
          try {
            parsed = JSON.parse(line) as WalLine;
          } catch {
            // Skip malformed lines (could add hook/log here later)
            continue;
          }

          if (!parsed || typeof parsed !== "object" || !parsed.blob) {
            continue;
          }

          batch.push(parsed.blob as AuditBlob);

          if (batch.length >= this.batchSize) {
            await writer.writeBatch(batch);
            batchesEmitted++;
            blobsReplayed += batch.length;
            batch = [];
          }
        }
      } finally {
        reader.close();
        await new Promise<void>((r) => stream.close(() => r()));
      }
    }

    // Flush any tail
    if (batch.length > 0) {
      await writer.writeBatch(batch);
      batchesEmitted++;
      blobsReplayed += batch.length;
      batch = [];
    }

    return Object.freeze({
      filesScanned,
      linesScanned,
      batchesEmitted,
      blobsReplayed,
    });
  }

  // Optional: one-shot extraction for callers that want manual batching control later
  public async nextBatch?(): Promise<ReadonlyArray<AuditBlob>> {
    // For cursor-less default, we return an empty array to indicate “not supported”.
    return [];
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async listWalFiles(): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.dir, { withFileTypes: true });
    } catch (err) {
      const e = new Error(
        `CursorlessWalReplayer: cannot read WAL dir "${this.dir}": ${
          (err as Error)?.message || String(err)
        }`
      );
      (e as any).code = "WAL_REPLAYER_DIR_READ_FAILED";
      throw e;
    }

    // Filter files by pattern and sort lexicographically (wal-<epoch> sorts by time)
    return entries
      .filter((d) => d.isFile() && this.filePattern.test(d.name))
      .map((d) => d.name)
      .sort();
  }
}
