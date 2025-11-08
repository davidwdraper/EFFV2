// backend/services/shared/src/wal/replay/CursorlessWalReplayer.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0029 — Contract-ID + BodyHandler pipeline (headers; route-picked schema)
 *
 * Purpose:
 * - Minimal, destination-agnostic WAL replayer that scans LDJSON journal files,
 *   extracts canonical contract-shaped entries, and hands them to an IAuditWriter in batches.
 *
 * Invariants (non-negotiable):
 * - Every entry MUST satisfy the locked AuditEntry contract. No back-compat transforms.
 * - If any line in a WAL file is invalid, quarantine the ENTIRE file (move to ./quarantine),
 *   emit an operator-friendly reason file, and continue. Do not block boot.
 * - No env literals; caller provides the directory.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import {
  AuditEntry,
  AuditEntriesRequest,
} from "../../contracts/audit/audit.entries.v1.contract";
import type { IAuditWriter } from "../writer/IAuditWriter";
import type { IWalReplayer, ReplayStats } from "../IWalReplayer";
import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";

export type CursorlessWalReplayerOptions = {
  /** Directory containing LDJSON WAL segments. */
  dir: string;
  /** Regex to select files; default: /^wal-.*\.ldjson$/ */
  filePattern?: RegExp;
  /** Max entries per batch sent to writer. Default: 100. */
  batchSize?: number;
};

type WalLine = { appendedAt: number; blob: unknown };

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

    for (const file of files) {
      filesScanned++;
      const abs = path.resolve(this.dir, file);

      const rl = await import("node:readline");
      const stream = fs.createReadStream(abs, { encoding: "utf8" });
      const reader = rl.createInterface({ input: stream, crlfDelay: Infinity });

      let batch: AuditBlob[] = [];
      let shouldQuarantine = false;
      let quarantineReason: any = undefined;
      let firstBadLineIdx = -1;

      try {
        let lineIdx = -1;
        for await (const line of reader) {
          lineIdx++;
          if (!line) continue;
          linesScanned++;

          let parsed: WalLine | undefined;
          try {
            parsed = JSON.parse(line) as WalLine;
          } catch (err) {
            shouldQuarantine = true;
            firstBadLineIdx = lineIdx;
            quarantineReason = {
              code: "WAL_LINE_JSON_PARSE_FAILED",
              message: (err as Error)?.message || String(err),
              atLine: lineIdx,
            };
            break;
          }

          const blob = parsed?.blob;

          // Item-level contract check (exact shape)
          const entryOk = AuditEntry.safeParse(blob);
          if (!entryOk.success) {
            shouldQuarantine = true;
            firstBadLineIdx = lineIdx;
            quarantineReason = {
              code: "WAL_ENTRY_CONTRACT_INVALID",
              issues: entryOk.error.issues,
              atLine: lineIdx,
            };
            break;
          }

          // Push as AuditBlob (schema already vetted)
          batch.push(entryOk.data as unknown as AuditBlob);

          if (batch.length >= this.batchSize) {
            // Batch-level contract check (mirrors service ingress)
            const reqOk = AuditEntriesRequest.safeParse({ entries: batch });
            if (!reqOk.success) {
              shouldQuarantine = true;
              firstBadLineIdx = lineIdx;
              quarantineReason = {
                code: "WAL_BATCH_CONTRACT_INVALID",
                issues: reqOk.error.issues,
                batchCount: batch.length,
                atLine: lineIdx,
              };
              break;
            }

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

      if (shouldQuarantine) {
        await this.quarantineFile(abs, {
          ...quarantineReason,
          firstBadLineIdx,
          file,
        });
        // discard any accumulated batch for this file; move on
        continue;
      }

      // Flush tail batch (if any), with the same contract check
      if (batch.length > 0) {
        const tailOk = AuditEntriesRequest.safeParse({ entries: batch });
        if (!tailOk.success) {
          await this.quarantineFile(abs, {
            code: "WAL_TAIL_CONTRACT_INVALID",
            issues: tailOk.error.issues,
            file,
          });
          continue;
        }

        await writer.writeBatch(batch);
        batchesEmitted++;
        blobsReplayed += batch.length;
        batch = [];
      }
    }

    return Object.freeze({
      filesScanned,
      linesScanned,
      batchesEmitted,
      blobsReplayed,
    });
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

    return entries
      .filter((d) => d.isFile() && this.filePattern.test(d.name))
      .map((d) => d.name)
      .sort(); // wal-<epoch>.ldjson sorts by time
  }

  private async quarantineFile(
    absPath: string,
    reason: unknown
  ): Promise<void> {
    try {
      const dir = path.dirname(absPath);
      const base = path.basename(absPath);
      const qDir = path.join(dir, "quarantine");
      const reasonPath = path.join(qDir, `${base}.reason.json`);
      const destPath = path.join(qDir, base);

      await fsp.mkdir(qDir, { recursive: true });
      await fsp.writeFile(
        reasonPath,
        JSON.stringify(reason ?? { code: "UNKNOWN" }, null, 2),
        { encoding: "utf8" }
      );
      await fsp.rename(absPath, destPath);

      // Loud operator signal without DI drift
      // eslint-disable-next-line no-console
      console.error(
        "wal_quarantine_file",
        JSON.stringify({ file: absPath, dest: destPath, reason }, null, 2)
      );
    } catch (err) {
      const e = new Error(
        `CursorlessWalReplayer: quarantine failed for "${absPath}": ${
          (err as Error)?.message || String(err)
        }`
      );
      (e as any).code = "WAL_REPLAYER_QUARANTINE_FAILED";
      throw e;
    }
  }
}
