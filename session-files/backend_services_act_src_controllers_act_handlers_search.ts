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
import { toActDto } from "../../../dto/actDto";
import * as repo from "../../../repo/actRepo";

export const search: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActByHometownQuery.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .type("application/problem+json")
      .json(
        clean({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          code: "VALIDATION_ERROR",
          detail: "Validation failed",
          errors: parsed.error.issues?.map((i) => ({
            path: i.path,
            message: i.message,
            code: i.code,
            expected: (i as any).expected,
            received: (i as any).received,
          })),
        })
      );
  }

  const { lat, lng, miles, q, limit, offset } = parsed.data;

  // Only treat geo as "on" if the caller explicitly provided all three keys
  const raw = req.query as Record<string, unknown>;
  const geoKeysProvided =
    Object.prototype.hasOwnProperty.call(raw, "lat") &&
    Object.prototype.hasOwnProperty.call(raw, "lng") &&
    Object.prototype.hasOwnProperty.call(raw, "miles");

  const hasGeo =
    geoKeysProvided &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    typeof miles === "number" &&
    miles > 0;

  // Typeahead requires q; blank q returns empty list
  if (!q || !q.trim()) {
    return respond(res, zActListDto, clean(makeList([], limit, offset, 0)));
  }

  // --- Build name-only filter for the result set ---
  const re = nameRegex(q);
  const nameClause = re ? { name: { $regex: re } } : {};

  const [items, total] = await Promise.all([
    repo.find(nameClause, limit, offset),
    repo.count(nameClause),
  ]);

  // --- areaTotal is geo metric when available; otherwise default to total ---
  let areaTotal = total;
  if (hasGeo) {
    const geoFilter = {
      homeTownLoc: {
        $geoWithin: { $centerSphere: [[lng, lat], milesToRadians(miles)] },
      },
    } as const;

    // Be defensive: if geo count flakes (e.g., index lag), don't let it drop below total
    const inArea = await repo.count(geoFilter);
    areaTotal = Math.max(total, inArea);
  }

  const schema = zActListDto.extend({
    mode: z.literal("typeahead"),
    areaTotal: z.number(),
  });

  return respond(
    res,
    schema,
    clean({
      ...makeList(items.map(toActDto), limit, offset, total),
      mode: "typeahead",
      areaTotal,
    })
  );
});

export const byHometown: RequestHandler = search;
