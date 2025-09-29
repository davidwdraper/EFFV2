// backend/services/act/src/controllers/act/handlers/update.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { updateActDto } from "../../validators/act.dto";
import * as repo from "../../repo/actRepo";

export async function update(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { id } = req.params;
  logger.debug({ requestId, actId: id }, "[ActHandlers.update] enter");
  try {
    const dto = updateActDto.parse(req.body);
    const saved = await repo.update(id, dto);
    if (!saved) {
      logger.debug({ requestId, actId: id }, "[ActHandlers.update] not_found");
      return res
        .status(404)
        .json({ code: "NOT_FOUND", detail: "Act not found" });
    }

    (req as any).audit?.push({
      type: "ACT_UPDATED",
      entity: "Act",
      entityId: saved._id,
      data: { fields: Object.keys(req.body || {}) },
    });

    logger.debug({ requestId, actId: saved._id }, "[ActHandlers.update] exit");
    res.json(saved);
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.update] error");
    next(err);
  }
}
