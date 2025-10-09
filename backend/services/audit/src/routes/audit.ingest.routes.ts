// backend/services/audit/src/routes/audit.ingest.routes.ts
/**
 * Docs:
 * - SOP: Core SOP (Reduced, Clean)
 * - ADRs:
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - adr0022-shared-wal-and-db-base (Audit ingest endpoint + WAL)
 *
 * Purpose:
 * - Wire the Audit ingest endpoint (batch append) to its controller.
 * - Reachability ping during bring-up.
 */

import { RouterBase } from "@nv/shared/base/RouterBase";
import { AuditIngestController } from "../controllers/audit.ingest.controller";

const SERVICE_SLUG = "audit" as const;

export class AuditIngestRouter extends RouterBase {
  private readonly ingestCtrl = new AuditIngestController();

  constructor() {
    super({ service: SERVICE_SLUG, context: { router: "AuditIngestRouter" } });
  }

  protected configure(): void {
    // Reachability ping
    this.get("/entries/ping", (_req, res) =>
      res.json({ ok: true, service: SERVICE_SLUG, data: { pong: true } })
    );

    // Ingest (batch)
    this.post("/entries", this.ingestCtrl.ingest());
  }
}
