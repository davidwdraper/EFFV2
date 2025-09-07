// backend/services/--template--/src/controllers/template/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import { createTemplateDto } from "../../../validators/template.dto";
import * as repo from "../../../repo/templateRepo";

/**
 * Create Template entity
 * - Auto-populates userCreateId, userOwnerId, dateCreated, dateLastUpdated.
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[template.controller.create] enter");

  try {
    // Validate input
    const dto = createTemplateDto.parse(req.body);

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
    logger.debug({ requestId, id: created._id }, "[template.controller.create] exit");
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}
