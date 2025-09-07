// backend/services/--template--/src/controllers/template/handlers/ping.ts
import type { Request, Response } from "express";
import { logger } from "../../../../../shared/utils/logger";

export async function ping(_req: Request, res: Response) {
  logger.debug({}, "[template.controller.ping] enter/exit");
  res.json({ ok: true });
}
