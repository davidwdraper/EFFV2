// backend/services/act/src/controllers/town/handlers/typeahead.ts
import type { Request, Response } from "express";
import { logger } from "../../../../../shared/utils/logger";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest, respond } from "@shared/src/contracts/http";
import { clean } from "@shared/src/contracts/clean";
import { escapeRe } from "../../../lib/search"; // <-- corrected path
import * as repo from "../../../repo/townRepo"; // <-- corrected path
import { toTownTypeaheadItem } from "../../../dto/townDto"; // <-- mapper (see #3)
import { zTypeaheadQuery, zTypeaheadResponse } from "./schemas";

/**
 * GET /towns/typeahead?q=Tam&limit=...
 */
export const typeahead = asyncHandler(async (req: Request, res: Response) => {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug(
    { requestId, q: req.query?.q, limit: req.query?.limit },
    "[TownHandlers.typeahead] enter"
  );

  const parsed = zTypeaheadQuery.safeParse(req.query);
  if (!parsed.success) {
    logger.debug({ requestId }, "[TownHandlers.typeahead] bad_request");
    return zodBadRequest(res, parsed.error, requestId);
  }
  const { q, limit } = parsed.data;

  if (!q || q.length < 3) {
    const out = zTypeaheadResponse.parse(clean({ count: 0, data: [] }));
    logger.debug(
      { requestId, count: out.count },
      "[TownHandlers.typeahead] short_query"
    );
    return respond(res, 200, out);
  }

  // Clamp valid-but-high limits to 50 for the actual query
  const effectiveLimit = Math.min(limit, 50);

  const rx = new RegExp(escapeRe(q), "i");
  const towns = await repo.find(
    {
      $or: [
        { name: rx },
        // reserved for future fields (e.g., aliases)
      ],
    },
    { name: 1, state: 1, lat: 1, lng: 1 },
    { name: 1 },
    effectiveLimit
  );

  const data = (towns ?? []).map(toTownTypeaheadItem);
  const out = zTypeaheadResponse.parse(clean({ count: data.length, data }));

  logger.debug(
    { requestId, count: out.count },
    "[TownHandlers.typeahead] 200 exit"
  );
  return respond(res, 200, out);
});
