// backend/services/--audit--/src/controllers/audit/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import { createAuditDto } from "../../../validators/audit.dto";
import * as repo from "../../../repo/auditRepo";

/**
 * Create Audit entity
 * - Auto-populates userCreateId, userOwnerId, dateCreated, dateLastUpdated.
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[audit.controller.create] enter");

  try {
    // Validate input
    const dto = createAuditDto.parse(req.body);

    // Inject audit/system fields
    const userId = (req as any).auth?.sub ?? "anonymous";
    const now = new Date();

    const entity = {
      ...dto,
      userCreateId: userId,
      userOwnerId: userId,
      dateCreated: now,
      dateLastUpdated: now,
    };

    const created = await repo.create(entity);
    logger.debug({ requestId, id: created._id }, "[audit.controller.create] exit");
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}
