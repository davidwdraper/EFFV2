// backend/services/audit/src/handlers/auditEvent/list.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 *
 * Why:
 * - Time-window listings with filters and cursor pagination for billing/forensics.
 *   Thin handler: validates primitives, delegates to repo.
 */

import type { Request, Response, NextFunction } from "express";
import * as repo from "../../repo/auditEventRepo";

export default async function list(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const q = req.query || {};

    const result = await repo.listEvents({
      fromTs: typeof q.fromTs === "string" ? q.fromTs : undefined,
      toTs: typeof q.toTs === "string" ? q.toTs : undefined,
      slug: typeof q.slug === "string" ? q.slug : undefined,
      requestId: typeof q.requestId === "string" ? q.requestId : undefined,
      userSub: typeof q.userSub === "string" ? q.userSub : undefined,
      finalizeReason:
        typeof q.finalizeReason === "string"
          ? (q.finalizeReason as any)
          : undefined,
      statusMin:
        typeof q.statusMin === "string" ? Number(q.statusMin) : undefined,
      statusMax:
        typeof q.statusMax === "string" ? Number(q.statusMax) : undefined,
      durationReliable:
        typeof q.durationReliable === "string"
          ? q.durationReliable === "true"
          : undefined,
      billingAccountId:
        typeof q.billingAccountId === "string" ? q.billingAccountId : undefined,
      billingSubaccountId:
        typeof q.billingSubaccountId === "string"
          ? q.billingSubaccountId
          : undefined,
      limit: typeof q.limit === "string" ? Number(q.limit) : undefined,
      cursor: typeof q.cursor === "string" ? q.cursor : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    return next(err as Error);
  }
}
