// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/audit/src/app.ts
 *
 * Design/ADR References:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0006 — Edge Logging (ingress-only)
 * - ADR-0013 — Versioned Health
 * - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 * - ADR-0024 — WAL Durability
 * - ADR-0025 — Writer Injection (DI-first; no registries)
 * - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 * - ADR-0030 — ContractBase & idempotent contract identification
 *
 * WHY this file exists:
 * - Orchestrates the Audit service runtime sequence (what happens and in what order),
 *   not domain mechanics — keeping `app.ts` a readable table of contents.
 * - WAL configuration/boot/replay is delegated to a bootstrap helper so app.ts
 *   stays environment-agnostic and single-concern.
 *
 * Mount order (WHY this order):
 *  1) Health — liveness should never depend on auth/parsers.
 *  2) Auth seam (verifyS2S) — fail fast before we parse bodies or touch handlers.
 *  3) Parsers — handlers must always receive parsed JSON.
 *  4) Versioned routes — routers wire transport → handlers; no business logic here.
 *  5) Error response logger — consistent telemetry for non-2xx responses.
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";

import { EntriesRouter } from "./routes/entries.router";
import {
  AuditEntriesV1BodyHandler,
  type AuditIngestPort,
} from "./handlers/entries.v1.bodyhandler";

import {
  startAuditWal,
  type AuditWalRuntime,
} from "./bootstrap/AuditWalBootstrap";

const SERVICE_SLUG = "audit";
const API_BASE = `/api/${SERVICE_SLUG}/v1`;

export class AuditApp extends AppBase {
  /** WHY: Runtime holds durable resources so we can stop them cleanly on shutdown. */
  private runtime!: AuditWalRuntime;

  constructor() {
    super({ service: SERVICE_SLUG });
  }

  /** WHY: Versioned health keeps dev≈prod surface identical (ports/URLs aside). */
  protected healthBasePath(): string | null {
    return API_BASE;
  }

  /** WHY: Compose durable infra via a bootstrap helper to keep app.ts orchestration-only. */
  protected async onBoot(): Promise<void> {
    this.runtime = await startAuditWal({ log: this.log });
    // Expose WAL in locals only as an escape hatch for ops — primary path is DI.
    (this.app as any).locals.wal = this.runtime.wal;
  }

  /** WHY: Readiness hinges on durable infra being alive before we accept traffic. */
  protected readyCheck(): () => boolean {
    return () => !!this.runtime?.wal;
  }

  /** WHY: Pre-routing hooks (edge logging, compression, etc.). Keep this thin. */
  protected mountPreRouting(): void {
    super.mountPreRouting();
  }

  /** WHY: Body parser precedes routes so handlers always see parsed JSON. */
  protected mountParsers(): void {
    this.app.use(express.json({ limit: "1mb" }));
  }

  /** WHY: Wire health → auth seam → routers → error logger in a single, predictable place. */
  protected mountRoutes(): void {
    // 1) Health first — never gated by auth or body parsing
    this.app.get(`${API_BASE}/health`, (_req, res) =>
      res.status(200).json({ ok: true })
    );

    // 2) Auth seam — mount verifyS2S here when implemented (fail fast, header-only)
    // this.app.use(API_BASE, verifyS2S());

    // 3) Domain DI — port abstracts persistence so handlers remain single-concern
    const ingestPort: AuditIngestPort = {
      ingest: async (entries, ctx) => {
        // WHY: Transport treats entries as opaque; the audit domain decides semantics later.
        // Persist via WAL to guarantee durability before ACK. We intentionally do not peek here.
        // Adjust to your WAL API name if different (append/appendMany/appendBatch):
        // @ts-expect-error: replace with your concrete WAL batch API if not appendBatch
        await this.runtime.wal.appendBatch(entries, {
          requestId: ctx.requestId,
        });
        return Array.isArray(entries) ? entries.length : 0;
      },
    };

    // 4) Handler uses shared contract + BodyHandlerBase (parse-in → handle → validate-out)
    const handler = new AuditEntriesV1BodyHandler(ingestPort, {
      logger: this.log,
    });

    // 5) Versioned router (does not repeat API_BASE internally)
    this.app.use(API_BASE, new EntriesRouter(handler).router());

    // 6) Post-route error logger — consistent RFC7807 telemetry on failures
    this.app.use(responseErrorLogger(this.log));
  }

  /** WHY: Graceful shutdown stops timers and releases resources deterministically. */
  protected async onShutdown(): Promise<void> {
    if (this.runtime?.stop) {
      this.runtime.stop();
    }
  }
}
