// backend/services/audit/src/handlers/auditEvent/ingest.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Security: docs/architecture/shared/SECURITY.md
 * - Scaling: docs/architecture/backend/SCALING.md
 *
 * Why:
 * - Intake must be fast + durable: validate → **AWAIT WAL append** → enqueue → 202.
 * - Idempotency handled at repo (unique eventId, $setOnInsert).
 */

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  putAuditEventsDto,
  asEventArray,
} from "../../validators/auditEvent.dto";
import { walAppend } from "../../services/wal";
import { enqueueForFlush } from "../../services/ingestQueue";

export default async function ingest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  try {
    let parsed;
    try {
      parsed = putAuditEventsDto.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) return next(err);
      return next(err as Error);
    }

    const events = asEventArray(parsed);

    try {
      await walAppend(events as unknown as Record<string, unknown>[]);
    } catch (err) {
      const e = err as Error;
      e.message = `[audit.ingest] WAL append failed: ${e.message}`;
      return next(e);
    }

    try {
      enqueueForFlush(events);
    } catch (err) {
      const e = err as Error;
      e.message = `[audit.ingest] enqueue failed (WAL persisted): ${e.message}`;
      return next(e);
    }

    res
      .status(202)
      .setHeader("X-Request-Id", requestId)
      .json({ ok: true, received: events.length, requestId });
  } catch (err) {
    return next(err as Error);
  }
}
