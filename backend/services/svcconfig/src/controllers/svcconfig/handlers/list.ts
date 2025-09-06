// backend/services/svcconfig/src/controllers/svcconfig/handlers/list.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import SvcConfigModel from "../../../models/svcconfig.model";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";

export async function list(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[SvcConfigHandlers.list] enter");
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200
    );
    const skip = Math.max(parseInt(String(req.query.skip ?? "0"), 10) || 0, 0);

    const docs = await SvcConfigModel.find({}).skip(skip).limit(limit);
    const items = docs.map((d) => dbToDomain(d as any));

    logger.debug(
      { requestId, count: items.length },
      "[SvcConfigHandlers.list] exit"
    );
    res.json({ items, count: items.length, limit, skip });
  } catch (err) {
    logger.debug({ requestId, err }, "[SvcConfigHandlers.list] error");
    next(err);
  }
}
