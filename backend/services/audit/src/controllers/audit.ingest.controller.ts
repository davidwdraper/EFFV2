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
 * - Echo canonical envelope required by smoke 010.
 *
 * Response (required by smoke 010):
 *   {
 *     "ok": true,
 *     "service": "audit",
 *     "data": { "accepted": <number-of-entries> }
 *   }
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
      (typeof randomUUID === "function" ? randomUUID() : `${Date.now()}`);

    const service = process.env.SVC_NAME || "audit";

    try {
      const body = (req.body ?? {}) as { entries?: unknown };
      const entries = Array.isArray((body as any).entries)
        ? ((body as any).entries as unknown[])
        : [];

      // Set request id for traceability (not required by the smoke, but helpful)
      res.setHeader("x-request-id", requestId);

      // Status code isn't asserted by the smoke; 200 is fine for the stub.
      res.status(200).json({
        ok: true,
        service,
        data: { accepted: entries.length }, // must be a NUMBER (jq -r compares to "2")
      });
    } catch (err) {
      res.setHeader("x-request-id", requestId);
      res.status(500).json({
        ok: false,
        service,
        error: {
          code: "internal_error",
          message:
            err instanceof Error ? err.message : "unexpected ingest failure",
        },
      });
    }
  };
}
