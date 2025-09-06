// backend/services/svcconfig/src/controllers/svcconfig/handlers/remove.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/svcconfig.repo";
import { publishChanged } from "../../../pubsub";

export async function remove(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { slug } = req.params;
  logger.debug({ requestId, slug }, "[SvcConfigHandlers.remove] enter");
  try {
    const updated = await repo.disable(slug);
    if (updated) {
      (req as any).audit?.push({
        type: "SVCCONFIG_DISABLED",
        entity: "SvcConfig",
        entityId: (updated as any)._id,
      });
      await publishChanged({ slug: updated.slug, version: updated.version! });
    }
    logger.debug({ requestId, slug }, "[SvcConfigHandlers.remove] exit");
    res.json({ ok: true });
  } catch (err) {
    logger.debug({ requestId, err }, "[SvcConfigHandlers.remove] error");
    next(err);
  }
}
