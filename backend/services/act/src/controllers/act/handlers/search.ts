// backend/services/act/src/controllers/act/handlers/search.ts
import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import {
  zodBadRequest,
  zActByHometownQuery,
  zActListDto,
  clean,
  respond,
} from "@shared/contracts";
import { makeList } from "@shared/http/pagination";
import { nameRegex, milesToRadians } from "../../../lib/search";
import Act from "../../../models/Act";
import { toActDto } from "../../../dto/actDto";

/**
 * Unified search handler used by:
 *   - GET /acts/search
 *   - GET /acts/by-hometown
 *
 * Behavior:
 *  - If `q` is a non-empty string ⇒ "typeahead" mode:
 *      * name regex + (optional) geo clamp by (lat,lng,radius)
 *      * total = count with name+geo
 *      * areaTotal = count with geo-only (ignores q)
 *  - If `q` is missing/empty ⇒ "radius" mode:
 *      * return all acts within the radius
 *      * total = areaTotal = count with geo-only
 */
export const search: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActByHometownQuery.safeParse(req.query);
  if (!parsed.success) {
    return zodBadRequest(res, parsed.error);
  }

  const {
    q,
    lat,
    lng,
    limit = 20,
    offset = 0,
  } = parsed.data as {
    q?: string;
    lat?: number;
    lng?: number;
    limit?: number;
    offset?: number;
  };

  // Support either schema naming: `radiusMiles` (new) or `miles` (legacy).
  // Prefer radiusMiles if present; otherwise fall back to miles.
  const anyData = parsed.data as any;
  const radius =
    typeof anyData?.radiusMiles === "number"
      ? anyData.radiusMiles
      : typeof anyData?.miles === "number"
      ? anyData.miles
      : undefined;

  const hasGeo =
    typeof lat === "number" &&
    typeof lng === "number" &&
    typeof radius === "number" &&
    radius > 0;

  const geoFilter = hasGeo
    ? {
        homeTownLoc: {
          $geoWithin: {
            $centerSphere: [
              [lng as number, lat as number],
              milesToRadians(radius as number),
            ],
          },
        },
      }
    : {};

  // areaTotal counts everything in the area (ignores q)
  const areaTotal = await Act.countDocuments(geoFilter).exec();

  const hasQ = typeof q === "string" && q.trim().length > 0;
  const mode: "typeahead" | "radius" = hasQ ? "typeahead" : "radius";

  const filter: Record<string, any> = { ...geoFilter };

  if (hasQ) {
    const re = nameRegex(q!);
    if (re) {
      filter.name = { $regex: re };
    } else {
      // Degenerate `q` (e.g., whitespace-only) → treat as radius-only
    }
  }

  const total = await Act.countDocuments(filter).exec();

  const items = await Act.find(filter)
    .sort(hasQ ? { name: 1 } : { _id: 1 }) // stable; switch to $geoNear later if you want distance sort
    .skip(offset)
    .limit(limit)
    .lean()
    .exec();

  const dtos = items.map(toActDto);

  return respond(
    res,
    zActListDto,
    clean({
      ...makeList(dtos, limit, offset, total),
      mode,
      areaTotal,
    })
  );
});

// Alias for route compatibility
export const byHometown: RequestHandler = search;
