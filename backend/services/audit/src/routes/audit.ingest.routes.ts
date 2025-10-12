// backend/services/audit/src/routes/audit.ingest.routes.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0006 — Edge Logging (first-class edge() channel)
 *
 * Purpose:
 * - Version-friendly router for audit ingestion.
 * - Single endpoint: POST /entries → controller.ingest (thin)
 *
 * Notes:
 * - App mounts this router under /api/audit/v1 (do not repeat base here).
 * - S2S ingress MUST pass through SvcReceiver to ensure EDGE logs and future auth.
 * - Controller returns { status?, body?, headers? }; SvcReceiver envelopes.
 */

import { Router, type Router as IRouter } from "express";
import type { AuditIngestController } from "../controllers/audit.ingest.controller";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";

export class AuditIngestRouter {
  private readonly r: IRouter;
  private readonly receiver: SvcReceiver;

  constructor(private readonly controller: AuditIngestController) {
    this.r = Router();
    this.receiver = new SvcReceiver("audit");

    // One-liner route; SvcReceiver guarantees EDGE logs + future auth seam.
    this.r.post("/entries", (req, res) =>
      this.receiver.receive(req as any, res as any, (ctx) =>
        this.controller.ingest(ctx, (req as any).app?.locals?.wal)
      )
    );
  }

  /** Return the Express Router for mounting by the app. */
  public router(): IRouter {
    return this.r;
  }
}
