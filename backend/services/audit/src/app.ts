// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 (Versioned Health Envelope & Routes)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0022 (Shared WAL & DB Base; environment invariance)
 *   - ADR-0024 (SvcClient/SvcReceiver refactor for S2S + audit DB assembly)
 *   - adr0023-wal-writer-reader-split
 *
 * Purpose:
 * - Orchestrator-only entrypoint. All construction lives in bootstrap builders.
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { Wal } from "@nv/shared/wal/Wal";
import { WalReplayer } from "@nv/shared/wal/WalReplayer";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditEntriesRouter } from "./routes/entries.router";
import { AuditWalFlusher } from "./workers/audit.flusher";
import { AuditRepo } from "./repo/audit.repo";
import {
  buildWal,
  buildAuditRepo,
  buildWalReplayer,
} from "./bootstrap/audit.builders";

const SERVICE = "audit";

export class AuditApp extends AppBase {
  private wal!: Wal;
  private flusher?: AuditWalFlusher;
  private replayer?: WalReplayer;
  private repo!: AuditRepo;

  constructor() {
    super({ service: SERVICE });
  }

  protected onBoot(): void {
    // IMPORTANT: bind bindLog so `this` is preserved when called later.
    const bound = (ctx: Record<string, unknown>) => this.bindLog(ctx);

    // WAL
    this.wal = buildWal(bound);

    // Repo (driver-agnostic; Mongo store currently)
    this.repo = buildAuditRepo(bound);

    // Live-path flusher
    this.flusher = new AuditWalFlusher(this.wal, this.repo);
    this.flusher.start();

    // Replay-path: LDJSON → repo
    this.replayer = buildWalReplayer(bound, this.repo);
    this.replayer.start();

    this.log.info({ walDir: process.env.WAL_DIR }, "audit_boot_ok");
  }

  protected healthBasePath(): string | null {
    return "/api/audit/v1";
  }

  protected readyCheck(): () => boolean {
    // TODO: refine with store ping when we add it.
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
