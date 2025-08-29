// backend/services/template/src/controllers/entity/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "../../../../../shared/utils/logger";
import { createEntityDto } from "../../../validators/entity.dto";
import * as repo from "../../../repos/entity.repo";

export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[EntityHandlers.create] enter");
  try {
    const dto = createEntityDto.parse(req.body);
    const created = await repo.create(dto);

    (req as any).audit?.push({
      type: "ENTITY_CREATED",
      entity: "Entity",
      entityId: created._id,
      data: { name: (created as any).name },
    });

    logger.debug(
      { requestId, entityId: created._id },
      "[EntityHandlers.create] exit"
    );
    res.status(201).json(created);
  } catch (err) {
    logger.debug({ requestId, err }, "[EntityHandlers.create] error");
    next(err);
  }
}
