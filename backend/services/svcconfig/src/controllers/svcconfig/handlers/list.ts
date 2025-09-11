// backend/services/svcconfig/src/controllers/svcconfig/handlers/list.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import SvcConfigModel from "../../../models/svcconfig.model";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";

export async function list(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[SvcConfigHandlers.list] enter");
  try {
    // if no limit query param, return all
    const rawLimit = req.query.limit as string | undefined;
    const rawSkip = req.query.skip as string | undefined;

    const skip = Math.max(parseInt(rawSkip ?? "0", 10) || 0, 0);
    const limit = rawLimit
      ? Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 200)
      : 0; // 0 means no limit

    const query = SvcConfigModel.find({});
    if (skip > 0) query.skip(skip);
    if (limit > 0) query.limit(limit);

    const docs = await query.exec();
    const items = docs.map((d) => dbToDomain(d as any));

    logger.debug(
      { requestId, count: items.length, limit, skip },
      "[SvcConfigHandlers.list] exit"
    );
    res.json({ items, count: items.length, limit: limit || null, skip });
  } catch (err) {
    logger.debug({ requestId, err }, "[SvcConfigHandlers.list] error");
    next(err);
  }
}
