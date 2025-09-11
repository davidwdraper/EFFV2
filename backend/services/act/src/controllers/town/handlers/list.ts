// backend/services/act/src/controllers/town/handlers/list.ts
import type { Request, Response } from "express";
import { logger } from "../../../../../shared/utils/logger";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest, respond } from "@shared/src/contracts/http";
import * as repo from "../../../repo/townRepo"; // <-- missing import added
import { toTownListItem } from "../../../dto/townDto";
import { zListQuery, zTownListItem } from "./schemas";

/** Escape a string for use inside a RegExp */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /towns?query=...&state=...&limit=...
 */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId, query: req.query }, "[TownHandlers.list] enter");

  const parsed = zListQuery.safeParse(req.query);
  if (!parsed.success) {
    logger.debug({ requestId }, "[TownHandlers.list] bad_request");
    return zodBadRequest(res, parsed.error, requestId);
  }
  const { query, state, limit } = parsed.data;

  const projection = { name: 1, state: 1, lat: 1, lng: 1 } as const;

  // Base filter: prefix OR contains on `name`
  const filter: Record<string, any> = {};
  if (query && query.length >= 1) {
    const starts = new RegExp("^" + escapeRe(query), "i");
    const contains = new RegExp(escapeRe(query), "i");
    filter.$or = [{ name: starts }, { name: contains }];
  }
  if (state) filter.state = state;

  let towns = await repo.find(filter, projection, { name: 1 }, limit);

  // Fallback 1: if nothing found but query exists, try tokens (≥3 chars) as contains
  if ((towns?.length ?? 0) === 0 && query) {
    const tokens = query.match(/[A-Za-z]{3,}/g) || [];
    for (const tok of tokens) {
      const rx = new RegExp(escapeRe(tok), "i");
      const relaxed = await repo.find(
        { ...(state ? { state } : {}), name: rx },
        projection,
        { name: 1 },
        limit
      );
      if (relaxed.length) {
        towns = relaxed;
        break;
      }
    }
  }

  // Fallback 2: still nothing? Return a small unfiltered slice (respects state & limit)
  if ((towns?.length ?? 0) === 0) {
    towns = await repo.find(
      state ? { state } : {},
      projection,
      { name: 1 },
      limit
    );
  }

  const payload = (towns ?? []).map(toTownListItem);

  // Validate output shape to keep the contract honest
  const out = zTownListItem.array().parse(payload);

  logger.debug(
    { requestId, count: out.length },
    "[TownHandlers.list] 200 exit"
  );
  return respond(res, 200, out); // <-- correct usage: (res, status, body)
});
