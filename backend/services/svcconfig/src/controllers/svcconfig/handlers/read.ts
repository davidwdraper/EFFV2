// backend/services/svcconfig/src/controllers/svcconfig/handlers/read.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/svcconfig.repo";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";

export async function read(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { slug } = req.params;
  logger.debug({ requestId, slug }, "[SrcServiceHandlers.read] enter");
  try {
    const doc = await repo.getBySlug(slug);
    if (!doc)
      return res
        .status(404)
        .json({ title: "Not Found", status: 404, detail: "Unknown slug" });
    res.json(dbToDomain(doc as any));
  } catch (err) {
    logger.debug({ requestId, err }, "[SrcServiceHandlers.read] error");
    next(err);
  }
}
