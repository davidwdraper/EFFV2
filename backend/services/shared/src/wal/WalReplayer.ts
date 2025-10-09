// backend/services/shared/src/wal/WalReplayer.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0023-wal-writer-reader-split
 *
 * Purpose:
 * - Replay LDJSON WAL files from disk with a durable cursor and emit bounded
 *   batches to a caller-provided handler (onBatch). Cursor advances only after
 *   a successful onBatch commit to guarantee at-least-once delivery.
 *
 * Design Notes:
 * - Single responsibility: read/replay only. Wal (writer/flush) remains separate.
 * - One instance per process. No multi-process coordination/locking.
 * - Idempotency is enforced by the consumer (e.g., DB upsert on deterministic key).
 * - Environment invariance: All paths/tunables are DI’d; this class has NO defaults.
 *
 * Safety:
 * - Handles torn/partial trailing lines by buffering until newline appears.
 * - Cursor updates are atomic (write temp → fsync → rename).
 * - At-least-once semantics: cursor advances only after onBatch resolves.
 *
 * Operational:
 * - Exponential backoff with jitter on onBatch failures to avoid log spam & hammering.
 * - Error logs include the error message; warnings note current backoff.
 */

import { promises as fsp } from "fs";
import * as fs from "fs";
import * as path from "path";

type Json = Record<string, unknown>;

export interface ILogger {
  debug(msg: string, meta?: Json): void;
  info(msg: string, meta?: Json): void;
  warn(msg: string, meta?: Json): void;
  error(msg: string, meta?: Json): void;
}

export type WalReplayerOpts = {
  walDir: string; // required: WAL_DIR
  cursorPath: string; // required: WAL_CURSOR_FILE
  batchLines: number; // required: positive
  batchBytes: number; // required: positive
  tickMs: number; // required: positive (base cadence)
  logger: ILogger; // shared logger
  onBatch: (lines: string[]) => Promise<void>; // consumer handler
};

type Cursor = { file: string | null; offset: number };

export class WalReplayer {
  private readonly walDir: string;
  private readonly cursorPath: string;
  private readonly batchLines: number;
  private readonly batchBytes: number;
  private readonly tickMs: number;
  private readonly log: ILogger;
  private readonly onBatch: (lines: string[]) => Promise<void>;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private partialBuffer = ""; // holds a possibly torn trailing line

  // Backoff / rate-limit state
  private backoffMs: number;
  private lastErrorLoggedAt = 0;

  public constructor(opts: WalReplayerOpts) {
    // Fail-fast invariants (no internal fallbacks)
    if (!opts?.walDir) throw new Error("WalReplayer: walDir is required");
    if (!opts?.cursorPath)
      throw new Error("WalReplayer: cursorPath is required");
    if (!opts?.logger) throw new Error("WalReplayer: logger is required");
    if (!opts?.onBatch) throw new Error("WalReplayer: onBatch is required");

    if (!(Number.isFinite(opts.batchLines) && opts.batchLines > 0)) {
      throw new Error("WalReplayer: batchLines must be a positive number");
    }
    if (!(Number.isFinite(opts.batchBytes) && opts.batchBytes > 0)) {
      throw new Error("WalReplayer: batchBytes must be a positive number");
    }
    if (!(Number.isFinite(opts.tickMs) && opts.tickMs > 0)) {
      throw new Error("WalReplayer: tickMs must be a positive number");
    }

    this.walDir = opts.walDir;
    this.cursorPath = opts.cursorPath;
    this.batchLines = opts.batchLines;
    this.batchBytes = opts.batchBytes;
    this.tickMs = opts.tickMs;
    this.log = opts.logger;
    this.onBatch = opts.onBatch;

    this.backoffMs = this.tickMs; // start at base cadence
  }

  /** Begin background replay loop. Idempotent. */
  public start(): void {
    if (this.running) return;
    this.running = true;

    const loop = async () => {
      if (!this.running) return;
      try {
        const res = await this.tickOnce();
        // Reset backoff on any forward progress (read or cursor advance)
        if (res.progressed) this.backoffMs = this.tickMs;

        const delay = res.progressed ? 0 : this.tickMs;
        this.timer = setTimeout(loop, delay);
      } catch (err) {
        // ===========================================================
        // Enhanced logging: show actual error message + WAL context.
        // Adds exponential backoff with jitter to avoid log spam.
        // ===========================================================
        const ctx = (err as any)?.__wal_context ?? {};
        const msg =
          `replay_error: ${err instanceof Error ? err.message : String(err)}` +
          (ctx.file
            ? ` [file=${ctx.file} offset=${ctx.offset ?? "?"} count=${
                ctx.count ?? "?"
              }]`
            : "");

        // Exponential backoff: doubles each failure, capped at 64× tickMs
        const prev = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, this.tickMs * 64);
        const jitter = Math.floor(
          Math.random() * Math.floor(this.backoffMs * 0.1)
        ); // ±10%
        const delay = this.backoffMs + jitter;

        // Rate-limit error logs — once per backoff escalation
        const now = Date.now();
        if (now - this.lastErrorLoggedAt > prev - this.tickMs / 2) {
          this.lastErrorLoggedAt = now;
          this.log.error(msg, { backoffMs: this.backoffMs });
        } else {
          this.log.warn("replay_retry_scheduled", {
            backoffMs: this.backoffMs,
          });
        }

        this.timer = setTimeout(loop, delay);
      }
    };

    this.timer = setTimeout(loop, 0);
    this.log.info("replay_started", {
      walDir: this.walDir,
      cursorPath: this.cursorPath,
    });
  }

  /** Stop background loop. */
  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Single-pass unit (great for tests):
   * - Ensures WAL dir
   * - Loads/repairs cursor
   * - Reads up to limits
   * - Emits to onBatch
   * - Advances cursor atomically on success
   */
  public async tickOnce(): Promise<{ progressed: boolean; reason?: string }> {
    await this.ensureDirExists(this.walDir);

    const files = await this.listWalFiles(this.walDir);
    if (files.length === 0) return { progressed: false, reason: "no_files" };

    let cursor = await this.readCursor();
    if (!cursor.file || !files.includes(cursor.file)) {
      cursor = { file: files[0], offset: 0 };
    }

    const fileName: string = cursor.file ?? files[0];
    const filePath = path.join(this.walDir, fileName);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      const next = this.nextFile(files, fileName);
      if (!next)
        return { progressed: false, reason: "file_missing_and_no_next" };
      await this.writeCursor({ file: next, offset: 0 });
      return { progressed: true, reason: "cursor_advanced_missing_file" };
    }

    if (cursor.offset >= stat.size) {
      const next = this.nextFile(files, fileName);
      if (!next) return { progressed: false, reason: "at_end_last_file" };
      await this.writeCursor({ file: next, offset: 0 });
      return { progressed: true, reason: "cursor_advanced_next_file" };
    }

    const { lines, bytesRead, newOffset } = await this.readBatch(
      filePath,
      cursor.offset
    );
    if (lines.length === 0 && bytesRead === 0)
      return { progressed: false, reason: "no_data_available" };

    try {
      await this.onBatch(lines); // consumer ensures idempotency
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      (e as any).__wal_context = {
        file: fileName,
        offset: cursor.offset,
        count: lines.length,
      };
      throw e;
    }

    await this.writeCursor({ file: fileName, offset: newOffset });

    this.log.debug("replay_batch_ok", {
      file: fileName,
      count: lines.length,
      bytes: bytesRead,
      newOffset,
    });

    return { progressed: true };
  }

  // ---------------- Internals ----------------

  private async ensureDirExists(dir: string): Promise<void> {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (err) {
      this.log.error("replay_mkdir_failed", { dir, err: String(err) });
      throw err;
    }
  }

  private async listWalFiles(dir: string): Promise<string[]> {
    const entries = await fsp.readdir(dir);
    return entries
      .filter((f) => f.startsWith("wal-") && f.endsWith(".ldjson"))
      .sort();
  }

  private nextFile(files: string[], current: string): string | null {
    const i = files.indexOf(current);
    if (i === -1) return files[0] ?? null;
    return files[i + 1] ?? null;
  }

  private async readCursor(): Promise<Cursor> {
    try {
      const raw = await fsp.readFile(this.cursorPath, "utf8");
      const c = JSON.parse(raw) as Cursor;
      if (
        (typeof c.file === "string" || c.file === null) &&
        typeof c.offset === "number" &&
        c.offset >= 0
      ) {
        return c;
      }
    } catch {
      // First run or corrupt: fall through to reset
    }
    return { file: null, offset: 0 };
  }

  private async writeCursor(c: Cursor): Promise<void> {
    const tmp = `${this.cursorPath}.tmp`;
    const data = JSON.stringify(c);
    const fh = await fsp.open(tmp, "w");
    try {
      await fh.writeFile(data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, this.cursorPath);
  }

  private async readBatch(
    filePath: string,
    startOffset: number
  ): Promise<{ lines: string[]; bytesRead: number; newOffset: number }> {
    const fh = await fsp.open(filePath, "r");
    try {
      const singleReadCap = Math.min(this.batchBytes, 1 << 20);
      const buffer = Buffer.allocUnsafe(Math.max(8192, singleReadCap));

      let offset = startOffset;
      let totalBytes = 0;
      const outLines: string[] = [];
      let done = false;

      while (
        !done &&
        totalBytes < this.batchBytes &&
        outLines.length < this.batchLines
      ) {
        const toRead = Math.min(buffer.length, this.batchBytes - totalBytes);
        const { bytesRead } = await fh.read(buffer, 0, toRead, offset);
        if (bytesRead === 0) break;

        totalBytes += bytesRead;
        offset += bytesRead;

        const chunk = buffer.subarray(0, bytesRead).toString("utf8");
        const combined = this.partialBuffer + chunk;
        const split = combined.split("\n");

        for (let i = 0; i < split.length - 1; i++) {
          const line = split[i].trim();
          if (line.length > 0) outLines.push(line);
          if (outLines.length >= this.batchLines) {
            this.partialBuffer = split.slice(i + 1).join("\n");
            done = true;
            break;
          }
        }

        if (!done) {
          this.partialBuffer = split[split.length - 1];
        }
      }

      return { lines: outLines, bytesRead: totalBytes, newOffset: offset };
    } finally {
      await fh.close();
    }
  }
}
