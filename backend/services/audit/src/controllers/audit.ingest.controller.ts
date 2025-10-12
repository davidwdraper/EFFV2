// backend/services/audit/src/controllers/audit.ingest.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *   - ADR-0022 — Shared WAL & DB Base
 *
 * Purpose:
 * - Handle POST /api/audit/v1/entries
 * - Validate AuditBatch via shared Zod schema and append to WAL.
 *
 * Notes:
 * - Resolve WAL at call time from req.app.locals.wal to avoid boot-order races.
 * - No environment literals. No silent fallbacks.
 */

import type { Request, Response } from "express";
import type { IWalEngine } from "@nv/shared/wal/IWalEngine";

import {
  AuditBatchSchema,
  type AuditBatch,
} from "@nv/shared/contracts/audit/audit.blob.contract";
import {
  AuditIngestAckSchema,
  type AuditIngestAck,
} from "@nv/shared/contracts/audit/audit.ack.contract";

export class AuditIngestController {
  private wal?: IWalEngine;

  constructor(wal?: IWalEngine) {
    this.wal = wal;
  }

  private getWal(req: Request): IWalEngine {
    const wal = this.wal ?? (req.app?.locals?.wal as IWalEngine | undefined);
    if (!wal) {
      const err: any = new Error("WAL not initialized");
      err.code = "WAL_NOT_READY";
      throw err;
    }
    return wal;
  }

  /** POST /entries — validate, append to WAL, return ACK */
  public ingest = async (req: Request, res: Response): Promise<void> => {
    const parsed = AuditBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        service: "audit",
        error: parsed.error.format(),
      });
      return;
    }
    const batch: AuditBatch = parsed.data;

    let wal: IWalEngine;
    try {
      wal = this.getWal(req);
    } catch (e) {
      res.status(503).json({
        ok: false,
        service: "audit",
        error: { message: (e as Error).message, code: (e as any)?.code },
      });
      return;
    }

    // Append; if this throws, we fail the request. No reliance on return value.
    await wal.appendBatch(batch.entries);

    // Deterministic accepted count = batch size (append succeeded or threw).
    const accepted = batch.entries.length;

    const ack: AuditIngestAck = AuditIngestAckSchema.parse({
      ok: true,
      service: "audit",
      data: { accepted },
    });

    res.status(200).json(ack);
  };
}
