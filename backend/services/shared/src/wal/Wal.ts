// backend/services/shared/src/wal/Wal.ts
/**
 * Design/ADR:
 * - adr0022-shared-wal-and-db-base
 * - Environment invariance, prod-parity: FS journaling is MANDATORY.
 *
 * Purpose:
 * - Shared Write-Ahead Log used by producers (gateway) and consumer (audit svc).
 * - Tier-0 in-memory queue + Tier-1 FS journal (append-only, LDJSON) — always on.
 *
 * Usage:
 *   const wal = Wal.fromEnv({ logger }); // logger: ILogger
 *   wal.append(entry);                // sync
 *   await wal.flush(persistFn);       // async drain to consumer callback
 *
 * Notes:
 * - No silent fallbacks. No on/off switch. If WAL_DIR is not set/writable, we fail.
 * - This class does not “send to network.” Callers supply a persist() for flush().
 */

import * as fs from "node:fs/promises";
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

  constructor(cfg: WalConfig) {
    if (!cfg.fsDir || !cfg.fsDir.trim()) {
      throw new Error("Wal: WAL_DIR (fsDir) is required");
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
      logger: opts?.logger,
    };
    return new Wal(cfg);
  }

  /** Append a single entry (sync). Always journals to FS. */
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
    const now = Date.now();
    this.currentFile = path.join(this.cfg.fsDir, `wal-${now}.ldjson`);
    this.currentSize = 0;
    this.fileCreatedAt = now;
    this.cfg.logger?.info("[WAL] rotate", { file: this.currentFile, reason });
  }

  /** Stop the background loop (if any). Call during graceful shutdown. */
  async stop(): Promise<void> {
    this.cfg.flushIntervalMs = 0 as unknown as number; // stop loop on next tick
    await this.loopHandle?.catch(() => {});
  }

  /* ------------------------------ Internals ------------------------------- */

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.cfg.fsDir, { recursive: true });
  }

  private async appendFs(entry: WalEntry): Promise<void> {
    await this.ensureDir();
    if (!this.currentFile) {
      await this.rotate("init");
    }
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.currentFile!, line, { encoding: "utf8" });
    this.currentSize += Buffer.byteLength(line);
    const needRotateBySize =
      this.cfg.rotateBytes && this.currentSize >= this.cfg.rotateBytes;
    const needRotateByTime =
      this.cfg.rotateMs && Date.now() - this.fileCreatedAt >= this.cfg.rotateMs;
    if (needRotateBySize || needRotateByTime) {
      await this.rotate(needRotateBySize ? "size" : "time");
    }
  }

  /** Background flush loop using no-op persist (safe) until caller provides one. */
  private async startFlushLoop(): Promise<void> {
    const interval = this.cfg.flushIntervalMs;
    while (this.cfg.flushIntervalMs > 0) {
      try {
        if (this.q.length > 0) {
          await this.flushNoopPersist();
        }
      } catch (err) {
        this.cfg.logger?.warn("[WAL] background flush error", { err });
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
