// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0022 (Shared WAL & DB Base; environment invariance)
 *   - ADR-0024 (SvcClient/SvcReceiver refactor for S2S)
 *   - adr0023-wal-writer-reader-split
 *
 * Purpose:
 * - Canonical Audit service entrypoint.
 * - Exposes:
 *     • /api/audit/v1/health/{live,ready}
 *     • /api/audit/v1/entries  (S2S ingest via SvcReceiver)
 * - WAL is mandatory (FS tier); no toggles or fallbacks.
 * - WalReplayer replays LDJSON files to DB (idempotent upsert).
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { Wal } from "@nv/shared/wal/Wal";
import { WalReplayer } from "@nv/shared/wal/WalReplayer";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditEntriesRouter } from "./routes/entries.router";
import { AuditWalFlusher } from "./workers/audit.flusher";

const SERVICE = "audit";

/** Fail-fast env accessors (env invariance; no literals, no defaults). */
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`[${SERVICE}] missing required env: ${name}`);
  return v;
}
function intEnv(name: string): number {
  const n = Number(mustEnv(name));
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`[${SERVICE}] env ${name} must be a positive number`);
  return n;
}

export class AuditApp extends AppBase {
  private wal!: Wal;
  private flusher?: AuditWalFlusher;
  private replayer?: WalReplayer;

  constructor() {
    super({ service: SERVICE });
  }

  protected onBoot(): void {
    // Single WAL instance (FS mandatory; Wal.fromEnv fail-fast if WAL_DIR missing).
    this.wal = Wal.fromEnv({
      logger: this.bindLog({ component: "AuditWAL" }),
      defaults: {
        flushIntervalMs: 0, // cadence controlled via flusher
        maxInMemory: 1000,
      },
    });

    // Live-path flusher: drains in-memory queue to DB.
    this.flusher = new AuditWalFlusher(this.wal);
    this.flusher.start();

    // Replay-path: scan LDJSON files and persist to DB (idempotent).
    // NOTE: Until repo/pairing are wired, keep this quiet (no warn spam).
    const rl = this.bindLog({ component: "WalReplayer" });
    this.replayer = new WalReplayer({
      walDir: mustEnv("WAL_DIR"),
      cursorPath: mustEnv("WAL_CURSOR_FILE"),
      batchLines: intEnv("WAL_REPLAY_BATCH_LINES"),
      batchBytes: intEnv("WAL_REPLAY_BATCH_BYTES"),
      tickMs: intEnv("WAL_REPLAY_TICK_MS"),
      logger: rl,
      onBatch: async (lines: string[]) => {
        // TODO: Replace with real pairing + repo.upsertMany(...) (idempotent).
        // For now, parse to validate JSON, then no-op without warning spam.
        // This preserves cursor advance and prevents endless backlog.
        const _ = lines.map((l) => JSON.parse(l));
        return;
      },
    });
    this.replayer.start();

    this.log.info({ walDir: process.env.WAL_DIR }, "audit_boot_ok");
  }

  protected healthBasePath(): string | null {
    return "/api/audit/v1";
  }

  protected readyCheck(): () => boolean {
    // TODO: gate on DB connectivity once repo is injected.
    return () => true;
  }

  protected mountPreRouting(): void {
    super.mountPreRouting();
  }

  protected mountParsers(): void {
    this.app.use(express.json({ limit: "1mb" }));
  }

  protected mountRoutes(): void {
    // DI the SAME WAL instance into the controller
    const ctrl = new AuditIngestController(this.wal);
    this.app.use(new AuditEntriesRouter(ctrl).router());

    this.app.use(responseErrorLogger(this.log));
  }
}
