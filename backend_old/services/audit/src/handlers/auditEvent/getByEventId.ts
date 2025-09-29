// backend/services/audit/src/handlers/auditEvent/getByEventId.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/handlers/auditEvent/getByEventId.ts
 * Service Slug: audit
 *
 * Why:
 *   Immutable point lookup for investigations/support.
 *   400 on missing param, 404 when not found; otherwise 200 with the event.
 *
 * References:
 *   SOP: docs/architecture/backend/SOP.md (New-Session SOP v4, Amended)
 *   Arch: docs/architecture/backend/OVERVIEW.md
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import * as repo from "../../repo/auditEventRepo";

export default async function getByEventId(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { eventId } = req.params || {};

  logger.debug({ requestId, eventId }, "[AuditHandlers.getByEventId] enter");

  try {
    if (!eventId || typeof eventId !== "string" || eventId.trim() === "") {
      logger.debug(
        { requestId },
        "[AuditHandlers.getByEventId] missing :eventId"
      );
      res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Missing :eventId",
      });
      return;
    }

    const doc = await repo.getByEventId(eventId);
    if (!doc) {
      logger.debug(
        { requestId, eventId },
        "[AuditHandlers.getByEventId] not found"
      );
      res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: `eventId ${eventId} not found`,
      });
      return;
    }

    logger.debug(
      { requestId, eventId },
      "[AuditHandlers.getByEventId] exit (200)"
    );
    res.status(200).json(doc);
  } catch (err) {
    logger.debug({ requestId, err }, "[AuditHandlers.getByEventId] error");
    return next(err as Error);
  }
}
