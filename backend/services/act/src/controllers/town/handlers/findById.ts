// backend/services/act/src/controllers/town/handlers/findById.ts
import type { Request, Response } from "express";
import { logger } from "../../../../../shared/utils/logger";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest, respond } from "@shared/src/contracts/http";
import { notFound } from "@shared/src/http/errors";
import * as repo from "../../../repo/townRepo";
import { toTownListItem } from "../../../dto/townDto";
import { zIdParam, zTownListItem } from "./schemas";

/**
 * GET /towns/:id
 */
export const findById = asyncHandler(async (req: Request, res: Response) => {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug(
    { requestId, id: req.params.id },
    "[TownHandlers.findById] enter"
  );

  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) {
    logger.debug({ requestId }, "[TownHandlers.findById] bad_request");
    return zodBadRequest(res, parsed.error, requestId);
  }
  const { id } = parsed.data;

  const t = await repo.findById(id, { name: 1, state: 1, lat: 1, lng: 1 });
  if (!t) {
    logger.debug({ requestId, id }, "[TownHandlers.findById] not_found");
    return notFound(res);
  }

  // Map DB doc → domain object
  const domain = toTownListItem(t);

  // Validate against contract before sending (optional but SOP-consistent)
  const out = zTownListItem.parse(domain);

  logger.debug({ requestId, id }, "[TownHandlers.findById] exit");
  return respond(res, 200, out); // <-- fixed signature
});
