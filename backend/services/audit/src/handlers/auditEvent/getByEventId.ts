// backend/services/audit/src/handlers/auditEvent/getByEventId.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 *
 * Why:
 * - Point lookup for investigations and support. Immutable read; returns 404 if missing.
 */

import type { Request, Response, NextFunction } from "express";
import * as repo from "../../repo/auditEventRepo";

export default async function getByEventId(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { eventId } = req.params || {};
  try {
    if (!eventId) {
      res
        .status(400)
        .json({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "Missing :eventId",
        });
      return;
    }
    const doc = await repo.getByEventId(String(eventId));
    if (!doc) {
      res
        .status(404)
        .json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: `eventId ${eventId} not found`,
        });
      return;
    }
    res.status(200).json(doc);
  } catch (err) {
    return next(err as Error);
  }
}
