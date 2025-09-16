// backend/services/act/src/controllers/act/handlers/list.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import ActModel from "../../models/Act";
import { dbToDomain } from "../../mappers/act.mapper";

export async function list(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[ActHandlers.list] enter");
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200
    );
    const skip = Math.max(parseInt(String(req.query.skip ?? "0"), 10) || 0, 0);
    const docs = await ActModel.find({}).skip(skip).limit(limit);
    const items = docs.map((d) => dbToDomain(d));
    logger.debug({ requestId, count: items.length }, "[ActHandlers.list] exit");
    res.json({ items, count: items.length, limit, skip });
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.list] error");
    next(err);
  }
}
