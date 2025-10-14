// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013 — Versioned Health Envelope & Routes
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *   - ADR-0026 — DbAuditWriter & FIFO Schema (writer is plugin, not referenced here)
 *
 * Purpose:
 * - Audit service wired to shared WAL: FS-backed journal + registry-based writer.
 * - Versioned health via AppBase. Ingestion route appends to WAL and ACKs.
 * - Optional **replay-on-boot** seam (env-gated) to drain existing WAL before traffic.
 *
 * Notes:
 * - Environment-invariant: no host/port literals anywhere.
 * - Strict envs: no defaults, no fallbacks — fail-fast if anything is missing/invalid.
 * - Writer registration via side-effect module path from env (drop-in friendly).
 * - Cadence is simple: call wal.flush() on a fixed interval; WAL owns retry/backoff/quarantine.
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditIngestRouter } from "./routes/audit.ingest.routes";

import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import { buildWal } from "@nv/shared/wal/WalBuilder";
import { AuditWriterFactory } from "@nv/shared/wal/writer/AuditWriterFactory";
import { listRegisteredWriters } from "@nv/shared/wal/writer/WriterRegistry";

const SERVICE_SLUG = "audit";
const API_BASE = `/api/${SERVICE_SLUG}/v1`;

export class AuditApp extends AppBase {
  private wal!: IWalEngine;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  // Keep the writer selection we booted with, so replay can instantiate the same writer
  private writerName!: string;

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
   * - Resolve writer **without** AUDIT_WRITER env:
   *    • If exactly one writer is registered → use it.
   *    • If zero or multiple → fail-fast with guidance to fix the registrar.
   * - Build WAL with that writer.
   * - (Optional) Replay-on-boot if AUDIT_REPLAY_ON_BOOT=true.
   * - Publish WAL to app.locals for controllers to resolve at call time.
   * - Start (or disable) flush cadence per explicit WAL_FLUSH_MS.
   */
  protected async onBoot(): Promise<void> {
    const dir = process.env.WAL_DIR?.trim();
    if (!dir) {
      throw new Error(
        "[audit] WAL_DIR env is required and must be an absolute, writable directory"
      );
    }

    const registerMod = process.env.AUDIT_WRITER_REGISTER?.trim();
    if (!registerMod) {
      throw new Error(
        "[audit] AUDIT_WRITER_REGISTER env is required (module path to writer registration)"
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

    // Load writer registration module (side-effect). No fallbacks.
    try {
      await import(registerMod);
    } catch (err: any) {
      const msg = err?.message || String(err);
      throw new Error(
        `[audit] Failed to load AUDIT_WRITER_REGISTER module "${registerMod}": ${msg}`
      );
    }

    // Resolve writer name strictly from what the registrar registered.
    const registered = listRegisteredWriters();
    if (registered.length === 0) {
      throw new Error(
        `[audit] No writers are registered after importing "${registerMod}". ` +
          `Ensure that module calls registerWriter("name", factory).`
      );
    }
    if (registered.length > 1) {
      throw new Error(
        `[audit] Multiple writers are registered (${registered.join(
          ", "
        )}) after importing "${registerMod}". ` +
          `Greenfield rule: use a single registrar that registers exactly one writer.`
      );
    }
    this.writerName = registered[0];

    // Build WAL (FS journal + registry-resolved writer). No env reads inside.
    this.wal = await buildWal({
      journal: { dir },
      writer: { name: this.writerName, options: {} },
    });

    // Optional: drain existing WAL before taking traffic, using the same writer type.
    if (replayOnBoot) {
      await this.tryReplayOnBoot({ dir });
      // One immediate flush in case replay enqueued in-memory items
      try {
        const { accepted } = await this.wal.flush();
        if (accepted > 0) this.log.info({ accepted }, "wal_flush_after_replay");
      } catch (err) {
        this.log.error({ err }, "***ERROR*** wal_flush_after_replay_failed");
      }
    }

    // Expose WAL to controllers (so route mounting order isn’t a race).
    this.app.locals.wal = this.wal;

    // Simple background cadence. WAL owns retry/backoff/quarantine; app stays thin.
    if (cadenceMs > 0) {
      this.flushTimer = setInterval(async () => {
        try {
          const { accepted } = await this.wal.flush();
          if (accepted > 0) this.log.info({ accepted }, "wal_flush");
        } catch (err) {
          // Single-line error; WAL already classifies and quarantines as needed.
          this.log.error({ err }, "***ERROR*** wal_flush_failed");
        }
      }, cadenceMs);
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
    // Controller resolves WAL from app.locals at call time; keeps tests simple.
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

  // ───────────────────────────────────────────────────────────────────────────
  // Optional replay-on-boot seam
  // Uses shared CursorlessWalReplayer ({dir}) and a fresh writer instance
  // of the same type configured for this process.
  // ───────────────────────────────────────────────────────────────────────────
  private async tryReplayOnBoot(opts: { dir: string }): Promise<void> {
    // This matches your provided path:
    // backend/services/shared/src/wal/replay/CursorlessWalReplayer.ts
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

      // Create a fresh writer instance of the same configured type.
      const writer = await AuditWriterFactory.create({
        name: this.writerName,
        options: {}, // keep options opaque/empty unless you later add some
      });

      const replayer = new Replayer({ dir: opts.dir });
      const stats = await replayer.replay(writer); // { filesScanned, linesScanned, batchesEmitted, blobsReplayed }

      this.log.info(
        { ...stats, module: loadedFrom },
        "wal_replay_on_boot_completed"
      );
    } catch (err) {
      this.log.error({ err }, "***ERROR*** wal_replay_on_boot_failed");
    }
  }
}
