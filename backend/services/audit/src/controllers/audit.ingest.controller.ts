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
 * - Keep HTTP path thin: no DB writes here; background flusher handles persistence.
 */

import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { AuditBatchContract } from "@nv/shared/contracts/audit/audit.batch.contract";
import { Wal, type WalEntry } from "@nv/shared/wal/Wal";
import type { RequestHandler } from "express";

const SERVICE = "audit" as const;

// Singleton WAL for this process (Tier-0 in-memory, optional FS tier via env).
const wal = Wal.fromEnv({
  // logger, // wire your shared logger if/when available
});

export class AuditIngestController extends ControllerBase {
  constructor() {
    super({ service: SERVICE });
  }

  /**
   * Express handler (wrapped via ControllerBase.handle()).
   * POST /api/audit/v1/entries
   */
  public ingest(): RequestHandler {
    return this.handle(async (ctx) => {
      // NOTE: HandlerCtx exposes `body` (not `req`). Use ctx.body per your base types.
      const batch = AuditBatchContract.parse(ctx.body, "AuditBatch");

      // Serialize entries to plain objects and cast to WalEntry[]
      const walBatch: WalEntry[] = batch.entries.map(
        (e) => e.toJSON() as unknown as WalEntry
      );

      // Append to WAL (fast, sync). Flusher will persist later.
      wal.appendMany(walBatch);

      const accepted = walBatch.length;

      // Canonical envelope via ControllerBase.ok()
      return this.ok(ctx, { accepted });
    });
  }
}
