// backend/services/act/src/controllers/town/handlers/ping.ts
import type { Request, Response } from "express";
import { logger } from "../../../../../shared/utils/logger";

export async function ping(_req: Request, res: Response) {
  logger.debug({}, "[TownHandlers.ping] enter/exit");
  res.json({ ok: true, resource: "towns", ts: new Date().toISOString() });
}
