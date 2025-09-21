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
 * - Ledger is insert-only (unique eventId). Idempotency via duplicates ignored.
 * - Contract (SOP): 202 + header `X-Audit-Received: <n>` + body `{ ok, received, requestId }`.
 */

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  putAuditEventsDto,
  asEventArray,
} from "../../validators/auditEvent.dto";
import { walAppend } from "../../services/wal";
import { logger } from "@eff/shared/src/utils/logger";

// ⬇️ NEW: signal the WAL drainer after WAL append so live API ingests flush to DB
import { scheduleWalDrain } from "../../services/walDrainer";

export default async function ingest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(
    req.headers["x-request-id"] || (req as any).id || ""
  );
  logger.debug({ requestId }, "[AuditHandlers.ingest] enter");

  try {
    // 1) Strict DTO validation against canonical contract
    let parsed;
    try {
      parsed = putAuditEventsDto.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) return next(err);
      return next(err as Error);
    }

    const events = asEventArray(parsed);

    // 2) Durability-first: WAL append (await)
    try {
      await walAppend(events as unknown as Record<string, unknown>[]);
    } catch (err) {
      const e = err as Error;
      e.message = `[audit.ingest] WAL append failed: ${e.message}`;
      return next(e);
    }

    // 3) Trigger drain of any pending WAL lines → DB (single-flight & idempotent)
    //    This is non-blocking; we acknowledge once the WAL is durable.
    try {
      scheduleWalDrain("ingest");
    } catch (err) {
      // Drain scheduling is best-effort; WAL durability already guaranteed above.
      logger.warn(
        { requestId, err },
        "[audit.ingest] scheduleWalDrain failed (WAL persisted)"
      );
    }

    // 4) Acknowledge with single, documented header + JSON body
    const count = events.length;
    logger.info({ requestId, count }, "[AuditHandlers.ingest] exit (202)");

    res
      .status(202)
      .setHeader("X-Request-Id", requestId)
      .setHeader("X-Audit-Received", String(count))
      .json({ ok: true, received: count, requestId });
  } catch (err) {
    return next(err as Error);
  }
}
