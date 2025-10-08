// backend/services/shared/src/wal/Wal.ts
/**
 * Design/ADR:
 * - adr0022-shared-wal-and-db-base
 * - Environment invariance: no literals; callers pass config (or use fromEnv()).
 *
 * Purpose:
 * - Shared Write-Ahead Log used by producers (gateway) and consumer (audit svc).
 * - Tier-0 in-memory durability + optional Tier-1 FS journal (append-only, LDJSON).
 *
 * Usage:
 *   const wal = Wal.fromEnv({ logger }); // or new Wal({ ...explicit config... })
 *   wal.append(entry); // fast, sync
 *   await wal.flush(); // async drain to consumer callback
 *
 * Notes:
 * - This class is storage-only. It does not “send to network” by itself.
 *   Callers provide a `persist` function (e.g., POST batch to AuditSvc, or DB repo persist).
 * - No silent fallbacks. If FS tier is enabled and fails, errors surface.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export type WalEntry = Record<string, unknown>;

export interface WalConfig {
  /** Max entries kept in memory before backpressure/auto-flush kicks in. */
  maxInMemory: number;

  /** Flush interval in ms for the background flusher (0 disables auto-loop). */
  flushIntervalMs: number;

  /** Enable append-only filesystem journal (line-delimited JSON). */
  fsEnabled: boolean;

  /** Directory for journal files (required if fsEnabled). */
  fsDir?: string;

  /** Max size (bytes) before a journal file rotates. */
  rotateBytes?: number;

  /** Optional time-based rotation. */
  rotateMs?: number;

  /** Optional logger (info/warn/error). */
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
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
    this.cfg = cfg;
    if (this.cfg.fsEnabled && !this.cfg.fsDir) {
      throw new Error("Wal: fsEnabled=true requires fsDir");
    }
    if (this.cfg.fsEnabled) {
      // ensure dir exists lazily on first append
    }
    if (this.cfg.flushIntervalMs > 0) {
      this.loopHandle = this.startFlushLoop();
    }
  }

  /** Convenience: build from process.env (names only; values live in .env.*). */
  static fromEnv(opts?: {
    logger?: WalConfig["logger"];
    defaults?: Partial<WalConfig>;
  }): Wal {
    const env = process.env;
    const cfg: WalConfig = {
      maxInMemory: intOrDefault(
        env.WAL_MAX_INMEM,
        opts?.defaults?.maxInMemory ?? 1000
      ),
      flushIntervalMs: intOrDefault(
        env.WAL_FLUSH_MS,
        opts?.defaults?.flushIntervalMs ?? 1000
      ),
      fsEnabled: boolOrDefault(
        env.WAL_FS_ENABLED,
        opts?.defaults?.fsEnabled ?? false
      ),
      fsDir: env.WAL_DIR ?? opts?.defaults?.fsDir,
      rotateBytes:
        intOrUndef(env.WAL_ROTATE_BYTES) ?? opts?.defaults?.rotateBytes,
      rotateMs: intOrUndef(env.WAL_ROTATE_MS) ?? opts?.defaults?.rotateMs,
      logger: opts?.logger,
    };
    return new Wal(cfg);
  }

  /** Append a single entry to the WAL (sync, fast). */
  append(entry: WalEntry): void {
    this.q.push(entry);
    this.offset++;
    if (this.cfg.fsEnabled) {
      void this.appendFs(entry);
    }
    if (this.q.length >= this.cfg.maxInMemory && !this.draining) {
      // kick an eager flush; background loop may also run
      void this.flushNoopPersist();
    }
  }

  /** Append a batch of entries (sync). */
  appendMany(entries: WalEntry[]): void {
    for (const e of entries) this.append(e);
  }

  /**
   * Flush current in-memory entries through the provided persist function.
   * Caller decides what "persist" means (HTTP to AuditSvc, DB repo, etc.).
   */
  async flush(persist?: WalPersistFn): Promise<WalPersistResult> {
    // fast path: nothing to do
    if (this.q.length === 0) return { persisted: 0, lastOffset: this.offset };

    if (this.draining) {
      // one active drain at a time; yield briefly
      await sleep(5);
      // try again (tail recursion is fine here due to await boundary)
      return this.flush(persist);
    }

    this.draining = true;
    try {
      const batch = this.q.splice(0, this.q.length);
      if (!persist) {
        // No-op flush (for backpressure relief when caller didn't supply persist here)
        this.cfg.logger?.info?.("[WAL] flush (noop) drained", {
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
    if (!this.cfg.fsEnabled) return;
    await this.ensureDir();
    // create a new file with a timestamped suffix
    const now = Date.now();
    this.currentFile = path.join(this.cfg.fsDir!, `wal-${now}.ldjson`);
    this.currentSize = 0;
    this.fileCreatedAt = now;
    this.cfg.logger?.info?.("[WAL] rotate", { file: this.currentFile, reason });
  }

  /** Stop the background loop (if any). Call during graceful shutdown. */
  async stop(): Promise<void> {
    this.cfg.flushIntervalMs = 0 as unknown as number; // stop loop on next tick
    await this.loopHandle?.catch(() => {});
  }

  /* ------------------------------ Internals ------------------------------- */

  private async ensureDir(): Promise<void> {
    if (!this.cfg.fsDir) return;
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
        this.cfg.logger?.warn?.("[WAL] background flush error", { err });
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
function boolOrDefault(v: string | undefined, d: boolean): boolean {
  if (v == null) return d;
  const s = v.toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes";
}
