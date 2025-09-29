// backend/services/audit/src/handlers/auditEvent/list.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/handlers/auditEvent/list.ts
 * Service Slug: audit
 *
 * Why:
 *   Time-window listings with filters and cursor pagination for billing/forensics.
 *   Thin handler: validate/coerce primitives → delegate to repo → return.
 *
 * References:
 *   SOP: docs/architecture/backend/SOP.md (New-Session SOP v4, Amended)
 *   Arch: docs/architecture/backend/OVERVIEW.md
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import * as repo from "../../repo/auditEventRepo";

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
function asInt(v: unknown): number | undefined {
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function asBool(v: unknown): boolean | undefined {
  if (typeof v !== "string") return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

export default async function list(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId, q: req.query }, "[AuditHandlers.list] enter");

  try {
    const q = req.query || {};

    const result = await repo.listEvents({
      fromTs: asStr(q.fromTs),
      toTs: asStr(q.toTs),
      slug: asStr(q.slug),
      requestId: asStr(q.requestId),
      userSub: asStr(q.userSub),
      finalizeReason: asStr(q.finalizeReason) as
        | "finish"
        | "timeout"
        | "client-abort"
        | "shutdown-replay"
        | undefined,
      statusMin: asInt(q.statusMin),
      statusMax: asInt(q.statusMax),
      durationReliable: asBool(q.durationReliable),
      billingAccountId: asStr(q.billingAccountId),
      billingSubaccountId: asStr(q.billingSubaccountId),
      limit: asInt(q.limit),
      cursor: asStr(q.cursor),
    });

    logger.debug(
      {
        requestId,
        count: result.items.length,
        nextCursor: !!result.nextCursor,
      },
      "[AuditHandlers.list] exit (200)"
    );
    res.status(200).json(result);
  } catch (err) {
    logger.debug({ requestId, err }, "[AuditHandlers.list] error");
    return next(err as Error);
  }
}
