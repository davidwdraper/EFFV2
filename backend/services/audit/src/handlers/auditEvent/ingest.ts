// backend/services/audit/src/handlers/auditEvent/ingest.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/handlers/auditEvent/ingest.ts
 * Service Slug: audit
 *
 * Why:
 *   Fast + durable intake path:
 *   validate DTO → AWAIT WAL append → enqueue for flush → 202 Accepted.
 *   Idempotency is enforced downstream via unique { eventId } and $setOnInsert.
 *
 * References:
 *   SOP: docs/architecture/backend/SOP.md (New-Session SOP v4, Amended)
 *   Arch: docs/architecture/backend/OVERVIEW.md
 *   Security: docs/architecture/shared/SECURITY.md
 *   Scaling: docs/architecture/backend/SCALING.md
 */

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "@eff/shared/src/utils/logger";
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
  logger.debug({ requestId }, "[AuditHandlers.ingest] enter");

  try {
    // 1) Parse/validate payload (accepts single event or non-empty array)
    let parsed;
    try {
      parsed = putAuditEventsDto.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        logger.debug(
          { requestId, issues: err.issues },
          "[AuditHandlers.ingest] zod validation error"
        );
        return next(err);
      }
      return next(err as Error);
    }

    const events = asEventArray(parsed);

    // 2) WAL-first durability: fs/append (await) before queueing DB work
    try {
      await walAppend(events as unknown as Record<string, unknown>[]);
    } catch (err) {
      const e = err as Error;
      e.message = `[audit.ingest] WAL append failed: ${e.message}`;
      logger.warn(
        { requestId, err: e },
        "[AuditHandlers.ingest] walAppend fail"
      );
      return next(e);
    }

    // 3) Enqueue for async flush to Mongo (may batch)
    try {
      enqueueForFlush(events);
    } catch (err) {
      const e = err as Error;
      e.message = `[audit.ingest] enqueue failed (WAL persisted): ${e.message}`;
      logger.warn({ requestId, err: e }, "[AuditHandlers.ingest] enqueue fail");
      return next(e);
    }

    // 4) Acknowledge acceptance
    logger.debug(
      { requestId, count: events.length },
      "[AuditHandlers.ingest] exit (202)"
    );
    res
      .status(202)
      .setHeader("X-Request-Id", requestId)
      .json({ ok: true, received: events.length, requestId });
  } catch (err) {
    logger.debug({ requestId, err }, "[AuditHandlers.ingest] error");
    return next(err as Error);
  }
}
