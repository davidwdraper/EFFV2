// backend/services/audit/src/controllers/AuditIngestController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0022 (Shared WAL & DB Base)
 *   - ADR-0024 (SvcClient/SvcReceiver refactor for S2S)
 *
 * Purpose:
 * - Validate incoming audit batches using OO contract (AuditBatchContract)
 *   and append to the FS-backed WAL.
 *
 * Invariance:
 * - No env literals; WAL is injected via composition.
 * - Contracts are the single source of truth (OO contracts, not Zod).
 */

import type { Wal } from "@nv/shared/wal/Wal";
import type { WalEntry } from "@nv/shared/wal/Wal";
import { AuditBatchContract } from "@nv/shared/contracts/audit/audit.batch.contract";

type ReceiveCtx = {
  requestId: string;
  method: string;
  path?: string;
  headers: Record<string, string>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
};

export class AuditIngestController {
  constructor(private readonly wal: Wal) {}

  /**
   * Handle POST /api/audit/v1/entries
   * Body: { entries: AuditEntryJson[] }
   */
  public async entries(ctx: ReceiveCtx): Promise<{
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }> {
    // Parse/validate using OO contract (throws on invalid)
    let accepted = 0;
    try {
      const batch = AuditBatchContract.parse(ctx.body, "AuditBatch");
      const entries = batch.entries.map((e) =>
        e.toJSON()
      ) as unknown as WalEntry[];

      // Append-many into the FS-backed WAL (Tier-1 durability).
      this.wal.appendMany(entries);
      accepted = entries.length;
    } catch (err) {
      // Contract parsing failed -> 400 with message
      const message = String(err instanceof Error ? err.message : err);
      return {
        status: 400,
        body: {
          error: {
            code: "invalid_batch",
            message,
          },
        },
        headers: { "x-request-id": ctx.requestId },
      };
    }

    // Controller returns domain result; SvcReceiver envelopes it
    return {
      status: 202,
      body: { accepted },
      headers: { "x-request-id": ctx.requestId },
    };
  }
}
