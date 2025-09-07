// backend/services/--template--/src/controllers/template/handlers/findById.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/templateRepo";
import { findByIdDto } from "./schemas";

export async function findById(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  try {
    const { id } = findByIdDto.parse(req.params);
    logger.debug({ requestId, id }, "[template.controller.findbyid] enter");

    const found = await repo.findById(id);
    if (!found) {
      return res.status(404).json({ type: "about:blank", title: "Not Found", status: 404, detail: "Entity not found" });
    }
    logger.debug({ requestId, id }, "[template.controller.findbyid] exit");
    res.json(found);
  } catch (err) {
    next(err);
  }
}
