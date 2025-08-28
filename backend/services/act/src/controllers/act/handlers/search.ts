// backend/services/act/src/controllers/act/handlers/search.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "../../../../../shared/utils/logger";
import ActModel from "../../../models/Act";
import { dbToDomain } from "../../../mappers/act.mapper";

// Basic search via querystring: ?nameLike=&genre=&actType=1,2
export async function search(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[ActHandlers.search] enter");
  try {
    const { nameLike, genre, actType } = req.query as Record<
      string,
      string | undefined
    >;
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200
    );
    const skip = Math.max(parseInt(String(req.query.skip ?? "0"), 10) || 0, 0);

    const q: any = {};
    if (nameLike) q.name = { $regex: nameLike, $options: "i" };
    if (genre) q.genreList = { $elemMatch: { $regex: genre, $options: "i" } };
    if (actType)
      q.actType = {
        $in: String(actType)
          .split(",")
          .map((n) => parseInt(n, 10))
          .filter(Number.isFinite),
      };

    const docs = await ActModel.find(q).skip(skip).limit(limit);
    const items = docs.map((d) => dbToDomain(d));
    logger.debug(
      { requestId, count: items.length },
      "[ActHandlers.search] exit"
    );
    res.json({ items, count: items.length, limit, skip });
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.search] error");
    next(err);
  }
}

// Search by hometown (homeTownId), optional nameLike filter
export async function byHometown(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[ActHandlers.byHometown] enter");
  try {
    const { homeTownId, nameLike } = req.query as Record<
      string,
      string | undefined
    >;
    if (!homeTownId)
      return res
        .status(400)
        .json({ code: "BAD_REQUEST", detail: "homeTownId is required" });

    const q: any = { homeTownId };
    if (nameLike) q.name = { $regex: nameLike, $options: "i" };

    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200
    );
    const skip = Math.max(parseInt(String(req.query.skip ?? "0"), 10) || 0, 0);

    const docs = await ActModel.find(q).skip(skip).limit(limit);
    const items = docs.map((d) => dbToDomain(d));
    logger.debug(
      { requestId, count: items.length },
      "[ActHandlers.byHometown] exit"
    );
    res.json({ items, count: items.length, limit, skip });
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.byHometown] error");
    next(err);
  }
}
