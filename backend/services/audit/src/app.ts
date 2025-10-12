// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 — Versioned Health Envelope & Routes
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Audit service wired to shared WAL: FS-backed journal + registry-based writer.
 * - Versioned health via AppBase. Ingestion route appends to WAL and ACKs.
 *
 * Notes:
 * - Environment-invariant: no host/port literals anywhere.
 * - Strict envs: no defaults, no fallbacks — fail-fast if anything is missing/invalid.
 * - Writer registration via side-effect module path from env (drop-in friendly).
 * - Optional flush cadence is STILL explicit: WAL_FLUSH_MS must be set (0 disables).
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditIngestRouter } from "./routes/audit.ingest.routes";

import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import { buildWal } from "@nv/shared/wal/WalBuilder";

const SERVICE_SLUG = "audit";
const API_BASE = `/api/${SERVICE_SLUG}/v1`;

export class AuditApp extends AppBase {
  private wal!: IWalEngine;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ service: SERVICE_SLUG });
  }

  /** Versioned health base under which AppBase mounts /health/{live,ready}. */
  protected healthBasePath(): string | null {
    return API_BASE;
  }

  /**
   * Boot:
   * - Validate required envs.
   * - Dynamically import writer register module (side-effect) from env.
   * - Build WAL with factory by name (keeps drop-in writer design intact).
   * - Publish WAL to app.locals for controllers to resolve at call time.
   * - Start (or disable) flush cadence per explicit WAL_FLUSH_MS.
   */
  protected async onBoot(): Promise<void> {
    const dir = process.env.WAL_DIR;
    if (!dir || !dir.trim()) {
      throw new Error(
        "[audit] WAL_DIR env is required and must be an absolute, writable directory"
      );
    }

    const registerMod = process.env.AUDIT_WRITER_REGISTER;
    if (!registerMod || !registerMod.trim()) {
      throw new Error(
        "[audit] AUDIT_WRITER_REGISTER env is required (module path to side-effect writer registration)"
      );
    }

    const writerName = process.env.AUDIT_WRITER;
    if (!writerName || !writerName.trim()) {
      throw new Error(
        "[audit] AUDIT_WRITER env is required (registry key for the writer registered by AUDIT_WRITER_REGISTER)"
      );
    }

    const msRaw = process.env.WAL_FLUSH_MS;
    if (msRaw === undefined) {
      throw new Error(
        "[audit] WAL_FLUSH_MS env is required (milliseconds; 0 disables the cadence)"
      );
    }
    const msNum = Number(msRaw);
    if (!Number.isFinite(msNum) || msNum < 0) {
      throw new Error(
        `[audit] WAL_FLUSH_MS must be a non-negative number, got "${msRaw}"`
      );
    }

    // Load writer registration module (side-effect). No fallbacks.
    try {
      await import(registerMod);
    } catch (err: any) {
      const msg = err?.message || String(err);
      throw new Error(
        `[audit] Failed to load AUDIT_WRITER_REGISTER module "${registerMod}": ${msg}`
      );
    }

    // Build WAL (FS journal + registry-resolved writer).
    this.wal = await buildWal({
      journal: { dir },
      writer: { name: writerName.trim(), options: {} },
    });

    // Expose WAL to controllers (so route mounting order isn’t a race).
    this.app.locals.wal = this.wal;

    // Optional background flush cadence (explicitly controlled; 0 disables).
    if (msNum > 0) {
      this.flushTimer = setInterval(async () => {
        try {
          const { accepted } = await this.wal.flush();
          if (accepted > 0) this.log.info({ accepted }, "wal_flush");
        } catch (err) {
          this.log.error({ err }, "***ERROR*** wal_flush_failed");
        }
      }, msNum);
      (this.flushTimer as any)?.unref?.();
    }
  }

  /** Report ready only after WAL is constructed and published. */
  protected readyCheck(): () => boolean {
    return () => !!this.wal && !!this.app.locals?.wal;
  }

  /** Minimal pre-routing; health handled by AppBase. */
  protected mountPreRouting(): void {
    super.mountPreRouting();
  }

  /** Parsers — conservative defaults. */
  protected mountParsers(): void {
    this.app.use(express.json({ limit: "1mb" }));
  }

  /** Mount routes and error logger. */
  protected mountRoutes(): void {
    // Do NOT rely on ctor-injected WAL here; controller resolves from app.locals at call time.
    const ctrl = new AuditIngestController();
    const router = new AuditIngestRouter(ctrl).router();

    this.app.use(API_BASE, router);
    this.app.use(responseErrorLogger(this.log));
  }

  /** Graceful shutdown: clear optional flush timer if present. */
  protected async onShutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
