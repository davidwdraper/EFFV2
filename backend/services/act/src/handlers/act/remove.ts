// backend/services/act/src/controllers/act/handlers/remove.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import ActModel from "../../models/Act";

export async function remove(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { id } = req.params;
  logger.debug({ requestId, actId: id }, "[ActHandlers.remove] enter");
  try {
    const doc = await ActModel.findByIdAndDelete(id);
    if (!doc) {
      logger.debug({ requestId, actId: id }, "[ActHandlers.remove] not_found");
      return res
        .status(404)
        .json({ code: "NOT_FOUND", detail: "Act not found" });
    }
    (req as any).audit?.push({
      type: "ACT_DELETED",
      entity: "Act",
      entityId: String(id),
    });
    logger.debug({ requestId, actId: id }, "[ActHandlers.remove] exit");
    res.status(204).send();
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.remove] error");
    next(err);
  }
}
