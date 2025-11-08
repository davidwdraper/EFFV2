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
 * - Controller is **framework-agnostic** and **does not** write to res.
 * - Returns { status?, body?, headers? } for SvcReceiver to envelope.
 * - WAL is supplied by the router (from app.locals) or injected via ctor.
 * - No environment literals. No silent fallbacks.
 */

import type { IWalEngine } from "@nv/shared/wal/IWalEngine";
import {
  AuditBatchSchema,
  type AuditBatch,
} from "@nv/shared/contracts/audit/audit.blob.contract";

type HandlerResult = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

type IngestCtx = {
  requestId: string;
  method: string;
  path?: string;
  headers: Record<string, string>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
};

export class AuditIngestController {
  private readonly injectedWal?: IWalEngine;

  constructor(wal?: IWalEngine) {
    this.injectedWal = wal;
  }

  private resolveWal(provided?: IWalEngine): IWalEngine {
    const wal = provided ?? this.injectedWal;
    if (!wal) {
      const err: any = new Error("WAL not initialized");
      err.code = "WAL_NOT_READY";
      throw err;
    }
    return wal;
  }

  /** POST /entries — validate, append to WAL, return {accepted} */
  public ingest = async (
    ctx: IngestCtx,
    walArg?: IWalEngine
  ): Promise<HandlerResult> => {
    const parsed = AuditBatchSchema.safeParse(ctx.body);
    if (!parsed.success) {
      // SvcReceiver will wrap into { ok:false, error }
      return { status: 400, body: { error: parsed.error.format() } };
    }
    const batch: AuditBatch = parsed.data;

    let wal: IWalEngine;
    try {
      wal = this.resolveWal(walArg);
    } catch (e) {
      return {
        status: 503,
        body: {
          error: {
            message: (e as Error).message,
            code: (e as any)?.code ?? "WAL_NOT_READY",
          },
        },
      };
    }

    await wal.appendBatch(batch.entries);

    // Return plain domain (no nested ACK); SvcReceiver will envelope.
    return {
      status: 200,
      body: { accepted: batch.entries.length },
    };
  };
}
