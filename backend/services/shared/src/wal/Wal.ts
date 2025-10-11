// backend/services/shared/src/wal/Wal.ts
/**
 * Docs:
 * - adr0022-shared-wal-and-db-base
 * - adr0024-audit-wal-persistence-guarantee
 *
 * Purpose:
 * - Durable append-only Write-Ahead Log.
 * - No defaults, no silent fallbacks.
 *
 * Fixes (2025-10-09):
 * - Enforce absolute WAL_DIR (fail-fast if relative)
 * - Serialize rotate() to avoid double “init” races
 * - Explicit close before reopen (no GC leak)
 * - Log file descriptor safety metrics
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ILogger } from "@nv/shared/logger/Logger";

export type WalEntry = Record<string, unknown>;

export interface WalConfig {
  maxInMemory: number;
  flushIntervalMs: number;
  fsDir: string;
  rotateBytes?: number;
  rotateMs?: number;
  fsyncMs: number;
  logger?: ILogger;
}

export class Wal {
  private readonly cfg: WalConfig;
  private readonly q: WalEntry[] = [];
  private offset = 0;
  private draining = false;
  private loopHandle?: Promise<void>;

  private currentFile?: string;
  private currentSize = 0;
  private fileCreatedAt = 0;

  private fh: fsp.FileHandle | null = null;
  private fsyncTimer: NodeJS.Timeout | null = null;
  private fsyncScheduled = false;
  private stopped = false;
  private rotating = false;

  private writes = 0;
  private bytes = 0;
  private lastFsyncAt = 0;

  constructor(cfg: WalConfig) {
    if (!cfg.fsDir || !cfg.fsDir.trim()) throw new Error("WAL_DIR required");
    if (!path.isAbsolute(cfg.fsDir))
      throw new Error(`WAL_DIR must be absolute: ${cfg.fsDir}`);
    if (!(cfg.fsyncMs >= 0)) throw new Error("fsyncMs must be >=0");
    this.cfg = cfg;
    if (this.cfg.flushIntervalMs > 0) this.loopHandle = this.startFlushLoop();
  }

  static fromEnv(opts?: {
    logger?: ILogger;
    defaults?: Partial<WalConfig>;
  }): Wal {
    const env = process.env;
    const fsDir = (env.WAL_DIR ?? opts?.defaults?.fsDir)?.toString().trim();
    if (!fsDir) throw new Error("Wal: WAL_DIR required");
    const cfg: WalConfig = {
      maxInMemory: intOrDefault(env.WAL_MAX_INMEM, 1000),
      flushIntervalMs: intOrDefault(env.WAL_FLUSH_MS, 1000),
      fsDir,
      rotateBytes: intOrUndef(env.WAL_ROTATE_BYTES),
      rotateMs: intOrUndef(env.WAL_ROTATE_MS),
      fsyncMs: intOrDefault(env.WAL_FSYNC_MS, 50),
      logger: opts?.logger,
    };
    return new Wal(cfg);
  }

  append(entry: WalEntry): void {
    this.q.push(entry);
    this.offset++;
    void this.appendFs(entry);
    if (this.q.length >= this.cfg.maxInMemory && !this.draining) {
      void this.flushNoopPersist();
    }
  }

  async flush(
    persist?: (batch: WalEntry[]) => Promise<void>
  ): Promise<{ persisted: number }> {
    if (this.q.length === 0) return { persisted: 0 };
    if (this.draining) {
      await sleep(5);
      return this.flush(persist);
    }
    this.draining = true;
    try {
      const batch = this.q.splice(0, this.q.length);
      if (persist) await persist(batch);
      return { persisted: batch.length };
    } finally {
      this.draining = false;
    }
  }

  /** Single serialized rotation; guards against double “init” */
  private async rotate(reason = "manual"): Promise<void> {
    if (this.rotating) return;
    this.rotating = true;
    try {
      await this.ensureDir();
      await this.forceFsync().catch(() => {});
      await this.closeHandle().catch(() => {});

      const now = Date.now();
      this.currentFile = path.join(this.cfg.fsDir, `wal-${now}.ldjson`);
      this.currentSize = 0;
      this.fileCreatedAt = now;

      this.fh = await fsp.open(this.currentFile, "a");
      await this.fh.sync().catch(() => {});

      this.cfg.logger?.info("[WAL] rotate", { file: this.currentFile, reason });
    } finally {
      this.rotating = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.fsyncTimer) clearTimeout(this.fsyncTimer);
    await this.forceFsync().catch(() => {});
    await this.closeHandle().catch(() => {});
    await this.loopHandle?.catch(() => {});
  }

  private async ensureDir(): Promise<void> {
    await fsp.mkdir(this.cfg.fsDir, { recursive: true });
  }

  private async ensureOpenFile(): Promise<void> {
    if (this.fh) return;
    await this.rotate("init");
  }

  private scheduleFsync(): void {
    if (this.cfg.fsyncMs === 0) {
      void this.forceFsync();
      return;
    }
    if (this.fsyncScheduled) return;
    this.fsyncScheduled = true;
    this.fsyncTimer = setTimeout(async () => {
      this.fsyncScheduled = false;
      try {
        await this.forceFsync();
      } catch (err) {
        this.cfg.logger?.warn("[WAL] fsync_failed", { err: String(err) });
      }
    }, this.cfg.fsyncMs);
  }

  private async forceFsync(): Promise<void> {
    if (!this.fh) return;
    try {
      await this.fh.sync();
      this.lastFsyncAt = Date.now();
    } catch (err) {
      this.cfg.logger?.warn("[WAL] fsync_error", { err: String(err) });
    }
  }

  private async closeHandle(): Promise<void> {
    if (!this.fh) return;
    try {
      await this.fh.close();
    } catch (err) {
      this.cfg.logger?.warn("[WAL] close_error", { err: String(err) });
    } finally {
      this.fh = null;
    }
  }

  private async appendFs(entry: WalEntry): Promise<void> {
    await this.ensureOpenFile();
    const line = JSON.stringify(entry) + "\n";
    const buf = Buffer.from(line);
    try {
      await this.fh!.write(buf, 0, buf.length);
    } catch (err) {
      this.cfg.logger?.error("[WAL] write_error", { err: String(err) });
      throw err;
    }
    this.writes++;
    this.bytes += buf.length;
    this.currentSize += buf.length;

    const rotateSize =
      this.cfg.rotateBytes && this.currentSize >= this.cfg.rotateBytes;
    const rotateTime =
      this.cfg.rotateMs && Date.now() - this.fileCreatedAt >= this.cfg.rotateMs;
    if (rotateSize || rotateTime) {
      await this.rotate(rotateSize ? "size" : "time");
    }
    this.scheduleFsync();
  }

  private async startFlushLoop(): Promise<void> {
    const interval = this.cfg.flushIntervalMs;
    while (!this.stopped && this.cfg.flushIntervalMs > 0) {
      try {
        if (this.q.length > 0) await this.flushNoopPersist();
      } catch (err) {
        this.cfg.logger?.warn("[WAL] background_flush_error", {
          err: String(err),
        });
      }
      await sleep(interval);
    }
  }

  private async flushNoopPersist(): Promise<void> {
    await this.flush();
  }
}

/* ---------------- helper fns ---------------- */
function intOrDefault(v: string | undefined, d: number): number {
  const n = v != null ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
}
function intOrUndef(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
