// backend/services/svcconfig/src/controllers/svcconfig/handlers/broadcast.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/svcconfig.repo";
import { publishChanged } from "../../../pubsub";

export async function broadcast(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { slug } = (req.body || {}) as { slug?: string };
  logger.debug({ requestId, slug }, "[SrcServiceHandlers.broadcast] enter");
  try {
    if (slug) {
      const doc = await repo.getBySlug(slug);
      if (!doc)
        return res
          .status(404)
          .json({ title: "Not Found", status: 404, detail: "Unknown slug" });
      await publishChanged({ slug: doc.slug, version: doc.version! });
      return res.json({ ok: true, slug: doc.slug, version: doc.version });
    }
    await publishChanged({ slug: null, version: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
