// backend/services/--template--/src/controllers/template/handlers/list.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/templateRepo";

export async function list(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[template.controller.list] enter");
  try {
    const items = await repo.list({ limit: 50, offset: 0 });
    logger.debug({ requestId, count: items.length }, "[template.controller.list] exit");
    res.json({ items });
  } catch (err) {
    next(err);
  }
}
