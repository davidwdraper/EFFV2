// backend/services/audit/src/workers/audit.flusher.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 * - ADR-0026 — DbAuditWriter & FIFO Schema (writer is a plugin; this class never touches DB/contracts)
 *
 * Purpose:
 * - Thin cadence wrapper around the shared WAL. It does not parse, pair, or persist.
 * - Calls `wal.flush()` on a fixed interval; the configured writer handles persistence.
 * - Keeps `app.ts` orchestration clean: app creates WAL & timer config; flusher just runs it.
 *
 * Invariants:
 * - No business logic here (no DTOs, repos, or contracts).
 * - No environment fallbacks — callers pass validated interval (or use `fromEnv()` which fails fast).
 * - Environment-agnostic (no host/port literals; no `.dist` imports).
 *
 * Usage:
 *   const flusher = AuditWalFlusher.fromEnv({ wal, log }); // throws if WAL_FLUSH_MS missing/invalid
 *   flusher.start();
 *   // on shutdown:
 *   await flusher.stop();
 */

import type { IWalEngine } from "@nv/shared/wal/IWalEngine";

type IBoundLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export class AuditWalFlusher {
  private readonly wal: IWalEngine;
  private readonly log: IBoundLogger;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    wal: IWalEngine;
    log: IBoundLogger;
    intervalMs: number;
  }) {
    this.wal = opts.wal;
    this.log = opts.log;
    this.intervalMs = opts.intervalMs;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 0) {
      throw new Error(
        `[audit.flusher] intervalMs must be a non-negative number, got "${opts.intervalMs}"`
      );
    }
  }

  /** Convenience: derive interval from env (fail-fast, no defaults). */
  static fromEnv(opts: {
    wal: IWalEngine;
    log: IBoundLogger;
  }): AuditWalFlusher {
    const raw = process.env.WAL_FLUSH_MS;
    if (raw === undefined) {
      throw new Error(
        "[audit.flusher] WAL_FLUSH_MS env is required (milliseconds; 0 disables cadence)"
      );
    }
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(
        `[audit.flusher] WAL_FLUSH_MS must be a non-negative number, got "${raw}"`
      );
    }
    return new AuditWalFlusher({
      wal: opts.wal,
      log: opts.log,
      intervalMs: ms,
    });
  }

  /** Start periodic flushes. NOP if already running. */
  start(): void {
    if (this.timer || this.intervalMs === 0) return;
    this.timer = setInterval(() => {
      // Fire-and-forget; errors handled internally
      void this.flushOnce();
    }, this.intervalMs);
    (this.timer as any)?.unref?.();
    this.log.info({ intervalMs: this.intervalMs }, "audit_wal_flusher_started");
  }

  /** Stop periodic flushes (idempotent). */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info({}, "audit_wal_flusher_stopped");
    }
  }

  /** One immediate flush. Writer performs persistence/backoff/quarantine. */
  async flushOnce(): Promise<void> {
    try {
      const { accepted } = await this.wal.flush();
      if (accepted > 0) {
        this.log.info({ accepted }, "wal_flush");
      }
    } catch (err: any) {
      this.log.error({ err }, "***ERROR*** wal_flush_failed");
    }
  }

  /** True if cadence is active. */
  isRunning(): boolean {
    return this.timer !== null;
  }
}
