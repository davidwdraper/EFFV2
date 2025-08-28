// backend/services/act/src/controllers/act/handlers/ping.ts
import type { Request, Response } from "express";
import { logger } from "../../../../../shared/utils/logger";

export async function ping(_req: Request, res: Response) {
  logger.debug({}, "[ActHandlers.ping] enter/exit");
  res.json({ ok: true });
}
