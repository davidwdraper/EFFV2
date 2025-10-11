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
 * Purpose (stub phase):
 * - Minimal Audit service app: versioned health is handled by AppBase.
 * - Mount a single ingestion route that ACKs requests for smoke tests.
 *
 * Notes:
 * - No S2S yet — that will arrive later via shared SvcReceiver (base class).
 * - No WAL/DB here; we’re just a dumb listener until WAL is added in shared.
 * - Environment-invariant: no host/port literals anywhere.
 */

import express from "express";
import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import { AuditIngestController } from "./controllers/audit.ingest.controller";
import { AuditIngestRouter } from "./routes/audit.ingest.routes";

const SERVICE_SLUG = "audit";
const API_BASE = `/api/${SERVICE_SLUG}/v1`;

export class AuditApp extends AppBase {
  constructor() {
    // AppBase owns logger/env/health wiring. No ports/hosts here.
    super({ service: SERVICE_SLUG });
  }

  /** Versioned health root. AppBase mounts /health/{live,ready} under this. */
  protected healthBasePath(): string | null {
    return API_BASE;
  }

  /** We’re a dumb listener in this phase: ready immediately. */
  protected readyCheck(): () => boolean {
    return () => true;
  }

  /** Pre-routing middleware hook — keep minimal now; health is in AppBase. */
  protected mountPreRouting(): void {
    super.mountPreRouting();
    // (intentionally empty for stub phase)
  }

  /** JSON parser only — keep limits conservative and overridable later. */
  protected mountParsers(): void {
    this.app.use(express.json({ limit: "1mb" }));
  }

  /** Mount the single ingestion route and the response error logger. */
  protected mountRoutes(): void {
    const ctrl = new AuditIngestController();
    const router = new AuditIngestRouter(ctrl).router();

    // One-liner mount under versioned base path (no duplication inside router).
    this.app.use(API_BASE, router);

    // Funnel unexpected errors to structured logs.
    this.app.use(responseErrorLogger(this.log));
  }
}
