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
 *
 * Purpose:
 * - Canonical Audit service entrypoint (greenfield, no legacy paths).
 * - Exposes:
 *     • /api/audit/v1/health/{live,ready}
 *     • /api/audit/v1/entries  (S2S ingest via SvcReceiver)
 * - WAL is mandatory (FS tier); no toggles or fallbacks.
 * - All S2S ingress normalized via shared SvcReceiver.
 *
 * Environment invariance:
 * - No host/port literals; no default fallbacks.
 * - WAL_DIR and DB vars required at startup; fail-fast otherwise.
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { Wal } from "@nv/shared/wal/Wal";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditEntriesRouter } from "./routes/entries.router";
import { AuditWalFlusher } from "./workers/audit.flusher";

const SERVICE = "audit";

export class AuditApp extends AppBase {
  private wal!: Wal;
  private flusher?: AuditWalFlusher;

  constructor() {
    super({ service: SERVICE });
  }

  protected onBoot(): void {
    // Single WAL instance for the whole service (FS mandatory; Wal.fromEnv fail-fast if WAL_DIR missing).
    this.wal = Wal.fromEnv({
      logger: this.bindLog({ component: "AuditWAL" }),
      defaults: {
        flushIntervalMs: 0, // we control cadence via flusher
        maxInMemory: 1000,
      },
    });

    // Start the flusher on the SAME WAL instance
    this.flusher = new AuditWalFlusher(this.wal);
    this.flusher.start();

    this.log.info({ walDir: process.env.WAL_DIR }, "audit_boot_ok");
  }

  protected healthBasePath(): string | null {
    return "/api/audit/v1";
  }

  protected readyCheck(): () => boolean {
    return () => true; // hook DB readiness here when desired
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
