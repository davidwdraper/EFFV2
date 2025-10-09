// backend/services/audit/src/routes/entries.router.ts
/**
 * Route is a one-liner that delegates to SvcReceiver.
 */
import { Router, type Request, type Response } from "express";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";
import type { AuditIngestController } from "../controllers/audit.ingest.controller";

export class AuditEntriesRouter {
  private readonly r = Router();
  private readonly recv = new SvcReceiver(process.env.SVC_NAME || "audit");

  constructor(private readonly controller: AuditIngestController) {
    this.r.post("/api/audit/v1/entries", (req: Request, res: Response) =>
      this.recv.receive(req as any, res as any, (ctx) =>
        this.controller.entries(ctx)
      )
    );
  }

  public router(): Router {
    return this.r;
  }
}
