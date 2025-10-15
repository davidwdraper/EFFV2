// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0013 — Versioned Health Envelope & Routes
 * - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 * - ADR-0022 — Shared WAL & DB Base
 * - ADR-0024 — WAL Durability
 * - ADR-0025 — Writer Injection (DI-first)
 * - ADR-0026 — DbAuditWriter & FIFO Schema
 *
 * Purpose:
 * - Audit service with FS-backed WAL + DI-injected DB writer.
 * - Versioned health; ingest route appends to WAL and ACKs.
 * - Optional replay-on-boot using the same writer instance.
 *
 * Notes:
 * - No writer registry. No AUDIT_WRITER*. The app **constructs** its writer and injects it.
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditIngestRouter } from "./routes/audit.ingest.routes";

import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import { buildWal } from "@nv/shared/wal/WalBuilder";
// Reuse existing DB writer for now (we can move it under services/audit later in Phase 2)
import { DbAuditWriter } from "@nv/shared/wal/writer/DbAuditWriter";

const SERVICE_SLUG = "audit";
const API_BASE = `/api/${SERVICE_SLUG}/v1`;

export class AuditApp extends AppBase {
  private wal!: IWalEngine;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  // Keep the writer instance we booted with so replay uses the same sink
  private writer!: DbAuditWriter;

  constructor() {
    super({ service: SERVICE_SLUG });
  }

  protected healthBasePath(): string | null {
    return API_BASE;
  }

  protected async onBoot(): Promise<void> {
    const dir = process.env.WAL_DIR?.trim();
    if (!dir) {
      throw new Error(
        "[audit] WAL_DIR env is required and must be an absolute, writable directory"
      );
    }

    const msRaw = process.env.WAL_FLUSH_MS;
    if (msRaw === undefined) {
      throw new Error(
        "[audit] WAL_FLUSH_MS env is required (milliseconds; 0 disables the cadence)"
      );
    }
    const cadenceMs = Number(msRaw);
    if (!Number.isFinite(cadenceMs) || cadenceMs < 0) {
      throw new Error(
        `[audit] WAL_FLUSH_MS must be a non-negative number, got "${msRaw}"`
      );
    }

    const replayOnBoot =
      String(process.env.AUDIT_REPLAY_ON_BOOT || "false").toLowerCase() ===
      "true";

    // Construct the DB writer directly (DI). No env reads here; pass options explicitly if/when needed.
    this.writer = new DbAuditWriter();

    // Build WAL with injected writer instance
    this.wal = await buildWal({
      journal: { dir },
      writer: { instance: this.writer },
    });

    if (replayOnBoot) {
      await this.tryReplayOnBoot({ dir });
      try {
        const { accepted } = await this.wal.flush();
        if (accepted > 0) this.log.info({ accepted }, "wal_flush_after_replay");
      } catch (err) {
        this.log.error({ err }, "***ERROR*** wal_flush_after_replay_failed");
      }
    }

    this.app.locals.wal = this.wal;

    if (cadenceMs > 0) {
      this.flushTimer = setInterval(async () => {
        try {
          const { accepted } = await this.wal.flush();
          if (accepted > 0) this.log.info({ accepted }, "wal_flush");
        } catch (err) {
          this.log.error({ err }, "***ERROR*** wal_flush_failed");
        }
      }, cadenceMs);
      (this.flushTimer as any)?.unref?.();
    }
  }

  protected readyCheck(): () => boolean {
    return () => !!this.wal && !!this.app.locals?.wal;
  }

  protected mountPreRouting(): void {
    super.mountPreRouting();
  }

  protected mountParsers(): void {
    this.app.use(express.json({ limit: "1mb" }));
  }

  protected mountRoutes(): void {
    const ctrl = new AuditIngestController();
    const router = new AuditIngestRouter(ctrl).router();

    this.app.use(API_BASE, router);
    this.app.use(responseErrorLogger(this.log));
  }

  protected async onShutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async tryReplayOnBoot(opts: { dir: string }): Promise<void> {
    // unchanged from your current version except using this.writer instead of factory-by-name
    const candidates = [
      "@nv/shared/wal/replay/CursorlessWalReplayer",
      "@nv/shared/wal/CursorlessWalReplayer",
    ];

    let mod: any = null;
    let loadedFrom: string | null = null;

    for (const spec of candidates) {
      try {
        mod = await import(/* @vite-ignore */ spec);
        loadedFrom = spec;
        break;
      } catch {
        // try next
      }
    }

    if (!mod) {
      this.log.warn(
        { candidates },
        "wal_replay_on_boot_skipped_module_not_found"
      );
      return;
    }

    try {
      const Replayer = mod.CursorlessWalReplayer ?? mod.default;
      if (typeof Replayer !== "function") {
        this.log.warn(
          { loadedFrom, exports: Object.keys(mod || {}) },
          "wal_replay_on_boot_unrecognized_module_shape"
        );
        return;
      }

      const replayer = new Replayer({ dir: opts.dir });
      const stats = await replayer.replay(this.writer);

      this.log.info(
        { ...stats, module: loadedFrom },
        "wal_replay_on_boot_completed"
      );
    } catch (err) {
      this.log.error({ err }, "***ERROR*** wal_replay_on_boot_failed");
    }
  }
}
