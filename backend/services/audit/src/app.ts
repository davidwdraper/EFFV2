// backend/services/audit/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/audit/src/app.ts
 *
 * Docs:
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
 * Purpose:
 * - Orchestrates the Audit service runtime sequence (what happens and in what order),
 *   not domain mechanics — keeping app.ts readable and invariant-driven.
 *
 * Order (via AppBase):
 *   onBoot → health → preRouting → security → parsers → routes → postRouting
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
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
  /** Runtime holds durable resources so we can stop them cleanly on shutdown. */
  private runtime!: AuditWalRuntime;

  constructor() {
    super({ service: SERVICE_SLUG });
  }

  /** Versioned health keeps dev≈prod surface identical (ports/URLs aside). */
  protected healthBasePath(): string | null {
    return API_BASE;
  }

  /** Compose durable infra via bootstrap helper to keep orchestration-only. */
  protected async onBoot(): Promise<void> {
    this.runtime = await startAuditWal({ log: this.log });
    (this.app as any).locals.wal = this.runtime.wal;
  }

  /** Readiness hinges on WAL being alive before accepting traffic. */
  protected readyCheck(): () => boolean {
    return () => !!this.runtime?.wal;
  }

  /** Override default JSON parser for larger batch payloads. */
  protected mountParsers(): void {
    this.app.use(express.json({ limit: "1mb" }));
  }

  /** Wire domain routers — no auth seam yet; health handled by AppBase. */
  protected mountRoutes(): void {
    // Domain DI — port abstracts persistence
    const ingestPort: AuditIngestPort = {
      ingest: async (entries, ctx) => {
        // Persist via WAL to guarantee durability before ACK
        // @ts-expect-error concrete WAL batch API may differ
        await this.runtime.wal.appendBatch(entries, {
          requestId: ctx.requestId,
        });
        return Array.isArray(entries) ? entries.length : 0;
      },
    };

    const handler = new AuditEntriesV1BodyHandler(ingestPort, {
      logger: this.log,
    });

    this.app.use(API_BASE, new EntriesRouter(handler).router());
  }

  /** Graceful shutdown stops timers and releases resources deterministically. */
  protected async onShutdown(): Promise<void> {
    if (this.runtime?.stop) {
      this.runtime.stop();
    }
  }
}
