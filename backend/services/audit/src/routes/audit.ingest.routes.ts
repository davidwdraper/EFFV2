// backend/services/audit/src/routes/audit.ingest.routes.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose (stub phase):
 * - Minimal, version-friendly router for audit ingestion.
 * - Single endpoint: POST /entries → controller.handle
 *
 * Notes:
 * - Health is mounted in AppBase (versioned).
 * - App mounts this router under /api/audit/v1 (do not repeat the base here).
 * - Future S2S will be enforced via shared SvcReceiver; router stays unchanged.
 */

import { Router, type Router as IRouter } from "express";
import type { AuditIngestController } from "../controllers/audit.ingest.controller";

export class AuditIngestRouter {
  private readonly r: IRouter;

  constructor(private readonly controller: AuditIngestController) {
    this.r = Router();
    // One-liner route; keeps controllers thin and testable.
    this.r.post("/entries", this.controller.handle);
  }

  /** Return the Express Router for mounting by the app. */
  public router(): IRouter {
    return this.r;
  }
}
