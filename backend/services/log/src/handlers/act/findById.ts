// backend/services/act/src/controllers/act/handlers/getById.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { findByIdDto } from "../../validators/act.dto";
import * as repo from "../../repo/actRepo";

export async function findById(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug(
    { requestId, actId: req.params.id },
    "[ActHandlers.findById] enter"
  );
  try {
    const { id } = findByIdDto.parse({ id: req.params.id });
    const act = await repo.findById(id);
    if (!act) {
      logger.debug({ requestId, actId: id }, "[ActHandlers.getById] not_found");
      return res
        .status(404)
        .json({ code: "NOT_FOUND", detail: "Act not found" });
    }
    logger.debug({ requestId, actId: id }, "[ActHandlers.getById] exit");
    res.json(act);
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.getById] error");
    next(err);
  }
}
