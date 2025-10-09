// backend/services/audit/src/controllers/audit.ingest.controller.ts
/**
 * Docs:
 * - SOP: Core SOP (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy — AppBase/ControllerBase)
 *   - ADR-0019 (Class Routers via RouterBase)
 *   - adr0022-shared-wal-and-db-base (Shared WAL; ingest appends → flusher persists)
 *
 * Purpose:
 * - Validate a batch of audit wire entries and append them to the shared WAL.
 * - Return canonical envelope via ControllerBase by returning { status, body }.
 */

import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { AuditBatchContract } from "@nv/shared/contracts/audit/audit.batch.contract";
import { auditWal } from "../wal/audit.wal";
import type { RequestHandler } from "express";
import type { WalEntry } from "@nv/shared/wal/Wal";

const SERVICE = "audit" as const;

export class AuditIngestController extends ControllerBase {
  constructor() {
    super({ service: SERVICE });
  }

  /** POST /api/audit/v1/entries */
  public ingest(): RequestHandler {
    return this.handle(async (ctx) => {
      // Validate body against canonical contract
      const batch = AuditBatchContract.parse(ctx.body, "AuditBatch");

      // Append to WAL (fast, sync)
      const walBatch: WalEntry[] = batch.entries.map(
        (e) => e.toJSON() as unknown as WalEntry
      );
      auditWal.appendMany(walBatch);

      // IMPORTANT: Return the shape ControllerBase expects.
      // No direct writes to res; the base will envelope { ok:true, service, data }.
      return {
        status: 200,
        body: { accepted: walBatch.length },
      };
    });
  }
}
