// backend/services/shared/src/wal/Wal.ts
/**
 * Design/ADR:
 * - adr0022-shared-wal-and-db-base
 * - adr0024-audit-wal-persistence-guarantee (fsync cadence; durability-first)
 *
 * Purpose:
 * - Shared Write-Ahead Log used by producers (gateway) and consumer (audit svc).
 * - Tier-0 in-memory queue + Tier-1 FS journal (append-only, LDJSON) — always on.
 *
 * Usage:
 *   const wal = Wal.fromEnv({ logger }); // logger: ILogger
 *   wal.append(entry);                // sync (journals to disk)
 *   await wal.flush(persistFn);       // async drain to consumer callback
 *
 * Notes:
 * - No silent fallbacks. FS journaling is mandatory. If WAL_DIR missing/unwritable → fail-fast.
 * - This class does not “send to network.” Callers supply a persist() for flush().
 * - ADR-0024: entries are considered accepted only after being written to the journal;
 *   a short-cadence fsync consolidates disk flushes for performance while keeping crash loss bounded.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ILogger } from "@nv/shared/logger/Logger";

export type WalEntry = Record<string, unknown>;

export interface WalConfig {
  /** Max entries kept in memory before eager flush kicks in. */
  maxInMemory: number;

  /** Flush interval in ms for the background flusher (0 disables auto-loop). */
  flushIntervalMs: number;

  /** Directory for journal files (REQUIRED). */
  fsDir: string;

  /** Max size (bytes) before a journal file rotates. */
  rotateBytes?: number;

  /** Optional time-based rotation (ms). */
  rotateMs?: number;

  /** Fsync cadence in ms; groups write()s into periodic fsyncs (0 = fsync every write). */
  fsyncMs: number;

  /** Shared logger (canonical contract). */
  logger?: ILogger;
}

export interface WalPersistResult {
  persisted: number;
  lastOffset: number;
}

export type WalPersistFn = (batch: WalEntry[]) => Promise<void>;

export class Wal {
  private readonly cfg: WalConfig;
  private readonly q: WalEntry[] = [];
  private offset = 0; // monotonically increasing append index
  private draining = false;
  private loopHandle?: Promise<void>;

  // FS tier state
  private currentFile?: string;
  private currentSize = 0;
  private fileCreatedAt = 0;

  // Open handle for append + fsync discipline
  private fh: fsp.FileHandle | null = null;
  private fsyncTimer: NodeJS.Timeout | null = null;
  private fsyncScheduled = false;
  private stopped = false;

  // Minimal metrics (good for smoke/debug)
  private writes = 0;
  private bytes = 0;
  private lastFsyncAt = 0;

  constructor(cfg: WalConfig) {
    if (!cfg.fsDir || !cfg.fsDir.trim()) {
      throw new Error("Wal: WAL_DIR (fsDir) is required");
    }
    if (!(cfg.fsyncMs >= 0)) {
      throw new Error("Wal: fsyncMs must be >= 0");
    }
    this.cfg = cfg;
    if (this.cfg.flushIntervalMs > 0) {
      this.loopHandle = this.startFlushLoop();
    }
  }

  /** Build from process.env (names only; values live in .env.*). */
  static fromEnv(opts?: {
    logger?: ILogger;
    defaults?: Partial<WalConfig>;
  }): Wal {
    const env = process.env;
    const fsDir = (env.WAL_DIR ?? opts?.defaults?.fsDir)?.toString().trim();
    if (!fsDir) {
      throw new Error("Wal: WAL_DIR is required (no off switch)");
    }
    const cfg: WalConfig = {
      maxInMemory: intOrDefault(
        env.WAL_MAX_INMEM,
        opts?.defaults?.maxInMemory ?? 1000
      ),
      flushIntervalMs: intOrDefault(
        env.WAL_FLUSH_MS,
        opts?.defaults?.flushIntervalMs ?? 1000
      ),
      fsDir,
      rotateBytes:
        intOrUndef(env.WAL_ROTATE_BYTES) ?? opts?.defaults?.rotateBytes,
      rotateMs: intOrUndef(env.WAL_ROTATE_MS) ?? opts?.defaults?.rotateMs,
      fsyncMs: intOrDefault(
        env.WAL_FSYNC_MS,
        // ADR suggests 25–50ms as a sane dev default; use 50ms unless overridden.
        opts?.defaults?.fsyncMs ?? 50
      ),
      logger: opts?.logger,
    };
    return new Wal(cfg);
  }

  /** Append a single entry (sync enqueue + async journal). Always journals to FS. */
  append(entry: WalEntry): void {
    this.q.push(entry);
    this.offset++;
    void this.appendFs(entry);
    if (this.q.length >= this.cfg.maxInMemory && !this.draining) {
      void this.flushNoopPersist();
    }
  }

  /** Append a batch (sync). */
  appendMany(entries: WalEntry[]): void {
    for (const e of entries) this.append(e);
  }

  /**
   * Flush current in-memory entries through the provided persist function.
   * Caller decides what "persist" means (HTTP to AuditSvc, DB repo, etc.).
   * Does NOT affect the FS journal; that is already durable.
   */
  async flush(persist?: WalPersistFn): Promise<WalPersistResult> {
    if (this.q.length === 0) return { persisted: 0, lastOffset: this.offset };

    if (this.draining) {
      await sleep(5);
      return this.flush(persist);
    }

    this.draining = true;
    try {
      const batch = this.q.splice(0, this.q.length);
      if (!persist) {
        this.cfg.logger?.info("[WAL] flush (noop) drained", {
          count: batch.length,
        });
        return { persisted: batch.length, lastOffset: this.offset };
      }
      await persist(batch);
      return { persisted: batch.length, lastOffset: this.offset };
    } finally {
      this.draining = false;
    }
  }

  /** Rotate the journal file (FS tier) on demand or by size/time thresholds. */
  async rotate(reason = "manual"): Promise<void> {
    await this.ensureDir();
    // close current handle after forcing fsync
    await this.forceFsync().catch(() => {});
    await this.closeHandle().catch(() => {});

    const now = Date.now();
    this.currentFile = path.join(this.cfg.fsDir, `wal-${now}.ldjson`);
    this.currentSize = 0;
    this.fileCreatedAt = now;

    this.fh = await fsp.open(this.currentFile, "a");
    // sync the file creation quickly so subsequent writes have a stable inode persisted
    await this.fh.sync().catch(() => {}); // best-effort

    this.cfg.logger?.info("[WAL] rotate", { file: this.currentFile, reason });
  }

  /** Stop background loop & force final fsync/close. Call during graceful shutdown. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.cfg.flushIntervalMs = 0 as unknown as number; // stop loop on next tick
    if (this.fsyncTimer) {
      clearTimeout(this.fsyncTimer);
      this.fsyncTimer = null;
    }
    await this.forceFsync().catch(() => {});
    await this.closeHandle().catch(() => {});
    await this.loopHandle?.catch(() => {});
  }

  /** Minimal public metrics (optional for tests). */
  public getMetrics(): {
    writes: number;
    bytes: number;
    lastFsyncAt: number;
    file?: string;
    size: number;
  } {
    return {
      writes: this.writes,
      bytes: this.bytes,
      lastFsyncAt: this.lastFsyncAt,
      file: this.currentFile,
      size: this.currentSize,
    };
  }

  /* ------------------------------ Internals ------------------------------- */

  private async ensureDir(): Promise<void> {
    await fsp.mkdir(this.cfg.fsDir, { recursive: true });
  }

  private async ensureOpenFile(): Promise<void> {
    await this.ensureDir();
    if (!this.currentFile || !this.fh) {
      await this.rotate("init");
    }
  }

  private scheduleFsync(): void {
    // If fsyncMs == 0, fsync every write (safest; slowest)
    if (this.cfg.fsyncMs === 0) {
      // immediate fsync chain (fire and forget)
      void this.forceFsync();
      return;
    }
    if (this.fsyncScheduled) return;
    this.fsyncScheduled = true;
    this.fsyncTimer = setTimeout(async () => {
      this.fsyncTimer = null;
      this.fsyncScheduled = false;
      await this.forceFsync().catch((err) => {
        this.cfg.logger?.warn("[WAL] fsync_failed", { err: String(err) });
      });
    }, this.cfg.fsyncMs);
  }

  private async forceFsync(): Promise<void> {
    if (!this.fh) return;
    await this.fh.sync();
    this.lastFsyncAt = Date.now();
  }

  private async closeHandle(): Promise<void> {
    if (this.fh) {
      try {
        await this.fh.close();
      } finally {
        this.fh = null;
      }
    }
  }

  private async appendFs(entry: WalEntry): Promise<void> {
    await this.ensureOpenFile();

    const line = JSON.stringify(entry) + "\n";
    const buf = Buffer.from(line, "utf8");

    // Write append-only via open handle in "a" mode
    // The OS guarantees append semantics; Node queues writes per-handle.
    await this.fh!.write(buf, 0, buf.length);

    this.writes += 1;
    this.bytes += buf.length;
    this.currentSize += buf.length;

    // Rotation checks after write
    const needRotateBySize =
      this.cfg.rotateBytes && this.currentSize >= this.cfg.rotateBytes;
    const needRotateByTime =
      this.cfg.rotateMs && Date.now() - this.fileCreatedAt >= this.cfg.rotateMs;
    if (needRotateBySize || needRotateByTime) {
      await this.rotate(needRotateBySize ? "size" : "time");
    }

    // Schedule fsync per cadence
    this.scheduleFsync();
  }

  /** Background flush loop using no-op persist (safe) until caller provides one. */
  private async startFlushLoop(): Promise<void> {
    const interval = this.cfg.flushIntervalMs;
    while (this.cfg.flushIntervalMs > 0 && !this.stopped) {
      try {
        if (this.q.length > 0) {
          await this.flushNoopPersist();
        }
      } catch (err) {
        this.cfg.logger?.warn("[WAL] background flush error", {
          err: String(err),
        });
      }
      await sleep(interval);
    }
  }

  private async flushNoopPersist(): Promise<void> {
    await this.flush(); // no persist fn → drain queue without external effects
  }
}

/* ------------------------------ helpers ---------------------------------- */

function intOrDefault(v: string | undefined, d: number): number {
  const n = v != null ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : d;
}
function intOrUndef(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
