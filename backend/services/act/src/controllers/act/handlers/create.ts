// backend/services/act/src/controllers/act/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import { createActDto } from "../../../validators/act.dto";
import * as repo from "../../../repo/actRepo";

export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[ActHandlers.create] enter");
  try {
    const dto = createActDto.parse(req.body);
    const created = await repo.create(dto as any); // repo fills/derives remaining fields

    (req as any).audit?.push({
      type: "ACT_CREATED",
      entity: "Act",
      entityId: created._id,
      data: { name: created.name, homeTownId: created.homeTownId },
    });

    logger.debug(
      { requestId, actId: created._id },
      "[ActHandlers.create] exit"
    );
    res.status(201).json(created);
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.create] error");
    next(err);
  }
}
