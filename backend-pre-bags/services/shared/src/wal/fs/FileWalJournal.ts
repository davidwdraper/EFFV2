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
 * Design:
 * - `append()` does a sync write against either a long-lived handle's fd
 *   or a one-shot temp fd (always closed). Long-lived handle is established
 *   lazily with an async open, but that open is **gated** so only one runs.
 * - `rotate()` and `close()` explicitly close the long-lived handle.
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
   * Default: 250ms.
   */
  fsyncIntervalMs?: number;
};

export class FileWalJournal implements IWalJournal {
  private readonly dir: string;
  private readonly nameFn: () => string;
  private readonly fsyncIntervalMs: number;

  private handle?: fs.promises.FileHandle; // long-lived async handle
  private currentPath?: string;
  private lastFsyncAt = 0;

  private opening = false; // gate to prevent concurrent async opens
  private openPromise?: Promise<void>;

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

  /** Async open of the long-lived handle, gated so only one runs at a time. */
  private ensureOpenGated(): void {
    if (this.handle || this.opening) return;

    this.opening = true;
    this.openPromise = (async () => {
      const name = this.nameFn();
      const p = path.resolve(this.dir, name);

      // Validate dir
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
        // Open/attach long-lived handle
        this.handle = await fsp.open(p, "a");
        this.currentPath = p;
        this.lastFsyncAt = 0;
      } finally {
        // Always clear opening flag, even on error (so callers can retry)
        this.opening = false;
        this.openPromise = undefined;
      }
    })();
    // Intentionally not awaited by append(); it’s truly lazy.
    // Callers who need to await can do `await this.openPromise` elsewhere.
  }

  /**
   * Synchronous append for durability-before-return.
   * If the long-lived handle isn't ready, write to a temp fd and **always close it**.
   * We kick off (once) the gated async open for future appends.
   */
  public append(line: string): void {
    let fd: number | undefined;
    let openedTempFd = false;

    try {
      const handleFd = (this.handle as any)?.fd;
      if (typeof handleFd === "number") {
        fd = handleFd as number;
      } else {
        // Long-lived handle not ready: use a temp sync fd for this write
        const p = this.currentPath ?? path.resolve(this.dir, this.nameFn());
        if (!this.currentPath) this.currentPath = p;

        try {
          fd = fs.openSync(p, "a");
          openedTempFd = true;
        } catch (err) {
          const e = new Error(
            `WAL openSync failed: ${(err as Error)?.message || String(err)}`
          );
          (e as any).code = "WAL_JOURNAL_OPEN_FAILED";
          throw e;
        }

        // Start one (and only one) async open of the long-lived handle
        this.ensureOpenGated();
      }

      // Write
      const buf = Buffer.from(line, "utf8");
      fs.writeSync(fd!, buf, 0, buf.length);
      this._bytesWritten += buf.length;
      this._linesWritten += 1;

      // Fsync policy
      const now = Date.now();
      if (
        this.fsyncIntervalMs === 0 ||
        now - this.lastFsyncAt >= this.fsyncIntervalMs
      ) {
        fs.fsyncSync(fd!);
        this.lastFsyncAt = now;
      }
    } catch (err) {
      const e = new Error(
        `WAL append failed: ${(err as Error)?.message || String(err)}`
      );
      (e as any).code = "WAL_JOURNAL_APPEND_FAILED";
      throw e;
    } finally {
      // Close any temp fd we opened
      if (openedTempFd && typeof fd === "number") {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore close error */
        }
      }
    }
  }

  /** Close current segment and open a new one. */
  public async rotate(): Promise<void> {
    if (this.handle) {
      try {
        await this.handle.sync();
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
    // After rotation, begin opening a new handle lazily.
    this.ensureOpenGated();
  }

  /** Explicit shutdown hook to avoid GC-based fd closing. */
  public async close(): Promise<void> {
    // If an open is in flight, let it settle (success or error) to avoid losing a handle.
    if (this.openPromise) {
      try {
        await this.openPromise;
      } catch {
        // ignore; we only care that it's no longer in-flight
      }
    }

    if (!this.handle) return;
    try {
      await this.handle.sync();
      await this.handle.close();
    } finally {
      this.handle = undefined;
      this.currentPath = undefined;
    }
  }

  public stats() {
    return {
      bytesWritten: this._bytesWritten,
      linesWritten: this._linesWritten,
      currentSegment: this.currentPath,
    } as const;
  }
}
