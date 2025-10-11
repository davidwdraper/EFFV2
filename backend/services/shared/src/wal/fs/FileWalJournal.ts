// backend/services/shared/src/wal/fs/FileWalJournal.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Minimal, durable file-backed WAL journal implementing `IWalJournal`.
 * - Synchronously appends single **lines** and fsyncs on a cadence.
 *
 * Design (lean + durable):
 * - Caller guarantees one-line payloads (engine already adds "\n"). We do not
 *   mutate or re-serialize; we just write bytes.
 * - `append()` writes to an open file descriptor and MAY fsync based on
 *   `fsyncIntervalMs`. If `fsyncIntervalMs` is 0, fsync on every append.
 * - `rotate()` closes the current fd and opens a new segment using `nameFn()`.
 *
 * Notes:
 * - No environment literals; all paths/policies are injected.
 * - Throws on any failure — no silent fallbacks.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import type { IWalJournal } from "../IWalJournal";

export type FileWalJournalOptions = {
  /** Directory that MUST already exist and be writable. */
  dir: string;

  /**
   * Function to produce a new segment file name. Must return a basename
   * (no directory). Default: wal-<epoch>.ldjson
   */
  nameFn?: () => string;

  /**
   * Fsync cadence in milliseconds. `0` → fsync on every append.
   * Default: 250ms (bounded loss window per ADR-0024).
   */
  fsyncIntervalMs?: number;
};

export class FileWalJournal implements IWalJournal {
  private readonly dir: string;
  private readonly nameFn: () => string;
  private readonly fsyncIntervalMs: number;

  private handle?: fs.promises.FileHandle;
  private currentPath?: string;
  private lastFsyncAt = 0;

  private _bytesWritten = 0;
  private _linesWritten = 0;

  constructor(opts: FileWalJournalOptions) {
    if (!opts?.dir) {
      const e = new Error("FileWalJournal requires a writable directory");
      (e as any).code = "WAL_JOURNAL_DIR_REQUIRED";
      throw e;
    }
    this.dir = opts.dir;
    this.nameFn = opts.nameFn ?? (() => `wal-${Date.now()}.ldjson`);
    this.fsyncIntervalMs = Math.max(0, opts.fsyncIntervalMs ?? 250);
  }

  /** Lazily open the current segment if needed. */
  private async ensureOpen(): Promise<void> {
    if (this.handle) return;
    const name = this.nameFn();
    const p = path.resolve(this.dir, name);

    // Ensure parent exists & is a directory (best-effort stat)
    try {
      const st = await fsp.stat(this.dir);
      if (!st.isDirectory()) {
        const e = new Error(`WAL dir is not a directory: ${this.dir}`);
        (e as any).code = "WAL_JOURNAL_DIR_INVALID";
        throw e;
      }
    } catch (err) {
      const e = new Error(
        `WAL dir not accessible: ${this.dir} — ${
          (err as Error)?.message || String(err)
        }`
      );
      (e as any).code = "WAL_JOURNAL_DIR_INACCESSIBLE";
      throw e;
    }

    try {
      this.handle = await fsp.open(p, "a"); // append mode
      this.currentPath = p;
      this.lastFsyncAt = 0;
    } catch (err) {
      const e = new Error(
        `WAL open failed: ${p} — ${(err as Error)?.message || String(err)}`
      );
      (e as any).code = "WAL_JOURNAL_OPEN_FAILED";
      throw e;
    }
  }

  public append(line: string): void {
    // We want `append` to be sync from the caller POV (durability before return).
    // Node's promises API is async; we block by running the async path and waiting via Atomics.
    // To keep it lean (and avoid worker threads), we instead use a simple deasync-like pattern:
    // perform a sync write using fs.writeFileSync on the file descriptor's path if available.
    // But since we maintain an open fd, we'll use `fs.writeSync` for the fd for atomicity.

    if (!this.handle) {
      // Open synchronously if missing (rare path).
      // We fallback to async open with a minimal busy-wait barrier to avoid pulling extra deps.
      // For simplicity and reliability, we do a synchronous open via fs.openSync here.
      const p = path.resolve(this.dir, this.nameFn());
      try {
        const fd = fs.openSync(p, "a");
        // Bridge the sync fd into our promises handle for later rotate/close
        // by reopening via promises; close the sync fd after duplication.
        // Simpler: keep both; but we’ll unify via fs.promises.open after.
        // To keep it truly consistent, re-open with promises immediately.
        fs.closeSync(fd);
      } catch (err) {
        const e = new Error(
          `WAL openSync failed: ${(err as Error)?.message || String(err)}`
        );
        (e as any).code = "WAL_JOURNAL_OPEN_FAILED";
        throw e;
      }
      // Now guarantee async handle exists (best-effort, should be fast since file exists)
      // Note: using sync path above ensures the file exists quickly.
      // We still must handle race conditions by calling ensureOpen() normally.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.ensureOpen();
    }

    // If handle still isn't ready due to async open, we try a last-chance sync open on currentPath.
    let fd: number | undefined;
    try {
      fd = (this.handle as any)?.fd ?? undefined;
      if (typeof fd !== "number") {
        // Last-chance: open a sync fd on currentPath (will exist from ensureOpen())
        const p = this.currentPath || path.resolve(this.dir, this.nameFn());
        fd = fs.openSync(p, "a");
        // We won't keep this temp fd after the write; close it below.
      }

      const buf = Buffer.from(line, "utf8");
      fs.writeSync(fd, buf, 0, buf.length);
      this._bytesWritten += buf.length;
      this._linesWritten += 1;

      // Fsync policy
      const now = Date.now();
      if (
        this.fsyncIntervalMs === 0 ||
        now - this.lastFsyncAt >= this.fsyncIntervalMs
      ) {
        fs.fsyncSync(fd);
        this.lastFsyncAt = now;
      }

      // Close temp fd if we opened one ad-hoc
      if (this.handle && fd !== (this.handle as any).fd) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }

      // If we didn’t have a promises handle before, try to establish it now (non-blocking).
      if (!this.handle) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.ensureOpen();
      }
    } catch (err) {
      const e = new Error(
        `WAL append failed: ${(err as Error)?.message || String(err)}`
      );
      (e as any).code = "WAL_JOURNAL_APPEND_FAILED";
      throw e;
    }
  }

  public async rotate(): Promise<void> {
    // Close current and open a new segment
    if (this.handle) {
      try {
        await this.handle.sync(); // ensure durability before rotate
        await this.handle.close();
      } catch (err) {
        const e = new Error(
          `WAL rotate close failed: ${(err as Error)?.message || String(err)}`
        );
        (e as any).code = "WAL_JOURNAL_ROTATE_CLOSE_FAILED";
        throw e;
      } finally {
        this.handle = undefined;
        this.currentPath = undefined;
      }
    }
    await this.ensureOpen();
  }

  public stats() {
    return {
      bytesWritten: this._bytesWritten,
      linesWritten: this._linesWritten,
      currentSegment: this.currentPath,
    } as const;
  }
}
