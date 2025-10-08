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
 * - Paths here are relative to /api/audit/v1 mount in app.ts.
 *
 * Notes:
 * - Routes are one-liners: import handlers only. No inline logic.
 * - Environment-invariant: slug fixed ("audit"); values from env/config elsewhere.
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
    // INGEST (batch): POST /entries
    this.post("/entries", this.ingestCtrl.ingest());
  }
}
