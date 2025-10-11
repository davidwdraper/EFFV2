// backend/services/audit/src/controllers/audit.ingest.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose (stub phase):
 * - Handle POST /api/audit/v1/entries as a dumb listener.
 * - No DB, no WAL, no S2S — just ACK with requestId for smoke tests.
 *
 * Notes:
 * - Health is mounted in AppBase (do not duplicate here).
 * - Future S2S will be handled via shared SvcReceiver; controller stays unchanged.
 */

import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";

export class AuditIngestController {
  /** Express handler for POST /api/audit/v1/entries */
  public handle = (req: Request, res: Response): void => {
    const requestId =
      (req.headers["x-request-id"] as string) ||
      (req.headers["x-correlation-id"] as string) ||
      (req.headers["request-id"] as string) ||
      (randomUUID?.() ?? `${Date.now()}`);

    // Environment invariance: service label comes from env when provided.
    const service = process.env.SVC_NAME || "audit";

    res.status(200).json({
      ok: true,
      service,
      requestId,
    });
  };
}
