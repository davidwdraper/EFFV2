// backend/services/svcconfig/src/controllers/svcconfig/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import { createSvcServiceDto } from "../../../validators/svcconfig.dto";
import * as repo from "../../../repo/svcconfig.repo";
import { publishChanged } from "../../../pubsub";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";

export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[SrcServiceHandlers.create] enter");
  try {
    const dto = createSvcServiceDto.parse(req.body) as any;

    const created = await repo.create({
      ...dto,
      updatedBy: (req as any).s2s?.caller || "system",
    });

    (req as any).audit?.push({
      type: "SVCCONFIG_CREATED",
      entity: "SvcConfig",
      entityId: (created as any)._id,
      data: { slug: created.slug },
    });

    await publishChanged({ slug: created.slug, version: created.version! });

    logger.debug(
      { requestId, slug: created.slug },
      "[svcconfig.handlers.create] exit"
    );
    res.status(201).json(dbToDomain(created as any));
  } catch (err) {
    logger.debug({ requestId, err }, "[svcconfig.handlers.create] error");
    next(err);
  }
}
