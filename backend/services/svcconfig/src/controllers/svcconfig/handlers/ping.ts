// backend/services/svcconfig/src/controllers/svcconfig/handlers/ping.ts
import type { Request, Response } from "express";
import { logger } from "@eff/shared/src/utils/logger";

export async function ping(_req: Request, res: Response) {
  logger.debug({}, "[SvcConfigHandlers.ping] enter/exit");
  res.json({ ok: true });
}
