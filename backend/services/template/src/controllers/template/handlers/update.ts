// backend/services/--template--/src/controllers/template/handlers/update.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/templateRepo";
import { updateTemplateDto, findByIdDto } from "./schemas";

/**
 * Partial update; dateLastUpdated is managed by service.
 */
export async function update(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  try {
    const { id } = findByIdDto.parse(req.params);
    const patch = updateTemplateDto.parse(req.body);

    logger.debug({ requestId, id }, "[template.controller.update] enter");
    const updated = await repo.update(id, patch);
    if (!updated) {
      return res.status(404).json({ type: "about:blank", title: "Not Found", status: 404, detail: "Entity not found" });
    }
    logger.debug({ requestId, id }, "[template.controller.update] exit");
    res.json(updated);
  } catch (err) {
    next(err);
  }
}
