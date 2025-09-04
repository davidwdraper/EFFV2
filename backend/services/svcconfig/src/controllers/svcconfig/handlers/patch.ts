// backend/services/svcconfig/src/controllers/svcconfig/handlers/patch.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import { updateSvcServiceDto } from "../../../validators/svcconfig.dto";
import * as repo from "../../../repo/svcconfig.repo";
import { publishChanged } from "../../../pubsub";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";

export async function patch(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { slug } = req.params;
  logger.debug({ requestId, slug }, "[SrcServiceHandlers.patch] enter");
  try {
    const dto = updateSvcServiceDto.parse(req.body) as any;
    const updated = await repo.patchBySlug(slug, {
      ...dto,
      updatedBy: (req as any).s2s?.caller || "system",
    });
    if (!updated)
      return res
        .status(404)
        .json({ title: "Not Found", status: 404, detail: "Unknown slug" });

    (req as any).audit?.push({
      type: "SVCCONFIG_UPDATED",
      entity: "SvcService",
      entityId: (updated as any)._id,
      data: { slug: updated.slug, version: updated.version },
    });

    await publishChanged({ slug: updated.slug, version: updated.version! });

    logger.debug(
      { requestId, slug: updated.slug },
      "[SrcServiceHandlers.patch] exit"
    );
    res.json(dbToDomain(updated as any));
  } catch (err) {
    logger.debug({ requestId, err }, "[SrcServiceHandlers.patch] error");
    next(err);
  }
}
