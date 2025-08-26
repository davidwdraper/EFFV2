// backend/services/act/src/controllers/actController.ts
import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import {
  zodBadRequest,
  zObjectId,
  zPagination,
  zActCreate,
  zActUpdate,
  zActByHometownQuery,
  zActDto,
  zActListDto,
  clean,
  respond,
} from "@shared/contracts";
import { notFound, badRequest as badRequestMsg } from "@shared/http/errors";
import { makeList } from "@shared/http/pagination";
import { UNFILTERED_CUTOFF } from "../config/search";
import { escapeRe, nameRegex, milesToRadians } from "../lib/search";
import { toActDto, toWire } from "../dto/actDTO";
import * as repo from "../repo/actRepo";

// Schemas
const zIdParam = z.object({ id: zObjectId });
const zListQuery = zPagination.extend({
  name: z.string().trim().min(1).max(200).optional(),
});

// Handlers
export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "act", ts: new Date().toISOString() });
});

// GET /acts?name=...
export const list: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zListQuery.safeParse(req.query);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { name, limit, offset } = parsed.data;

  const filter: Record<string, any> = {};
  if (name) filter.name = { $regex: new RegExp(escapeRe(name), "i") };

  const [rows, total] = await Promise.all([
    repo.list(filter, limit, offset),
    repo.count(filter),
  ]);

  return respond(
    res,
    zActListDto,
    makeList(rows.map(toActDto), limit, offset, total)
  );
});

export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  const doc = await repo.findById(id);
  if (!doc) return notFound(res);
  return respond(res, zActDto, toActDto(doc));
});

// GET /acts/search (and /acts/by-hometown)
export const search: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActByHometownQuery.safeParse(req.query);
  if (!parsed.success) {
    // keep error shape via @shared/contracts helper
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

  const geoFilter = {
    homeTownLoc: {
      $geoWithin: { $centerSphere: [[lng, lat], milesToRadians(miles)] },
    },
  };

  const totalInRadius = await repo.count(geoFilter);

  if (q && q.trim()) {
    const re = nameRegex(q);
    const filter = re ? { ...geoFilter, name: { $regex: re } } : geoFilter;

    const [items, total] = await Promise.all([
      repo.find(filter, limit, offset),
      repo.count(filter),
    ]);

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
        areaTotal: totalInRadius,
      })
    );
  }

  if (totalInRadius <= UNFILTERED_CUTOFF) {
    const items = await repo.find(geoFilter, limit, offset);

    const schema = zActListDto.extend({
      mode: z.literal("all-in-radius"),
    });

    return respond(
      res,
      schema,
      clean({
        ...makeList(items.map(toActDto), limit, offset, totalInRadius),
        mode: "all-in-radius",
      })
    );
  }

  return badRequestMsg(
    res,
    "Too many results in area; provide q for typeahead",
    { code: "NEEDS_QUERY", total: totalInRadius }
  );
});

export const byHometown: RequestHandler = search;

/**
 * POST /acts
 * Semantics:
 *   - Only (name + homeTownId) must be unique.
 *   - Same name in different hometowns is allowed.
 * Strategy:
 *   - If homeTownId present -> upsert on {name, homeTownId} (idempotent; no 11000).
 *   - If homeTownId absent -> plain create (allow name duplicates).
 */
export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActCreate.safeParse(req.body ?? {});
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
  const body = parsed.data as Record<string, any>;

  const nowIso = new Date().toISOString();
  const toInsert = clean({
    ...toWire(body),
    dateCreated: (body as any).dateCreated ?? nowIso,
    dateLastUpdated: nowIso,
  });

  if (typeof body?.homeTownId === "string" && body.homeTownId.trim() !== "") {
    const doc = await repo.upsertByNameAndHometown(
      body.name,
      body.homeTownId,
      toInsert
    );
    return respond(res, zActDto, toActDto(doc), 201);
  }

  try {
    const created = await repo.create(toInsert);
    const lean = await repo.findById(String(created._id));
    return respond(res, zActDto, toActDto(lean), 201);
  } catch (err: any) {
    const isDup =
      err?.code === 11000 ||
      err?.code === "11000" ||
      (typeof err?.message === "string" &&
        /E11000 duplicate key/i.test(err.message));
    if (isDup && body?.name) {
      const existing = await repo.findByName(body.name);
      if (existing) return respond(res, zActDto, toActDto(existing), 201);
    }
    throw err;
  }
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const idParsed = zIdParam.safeParse(req.params);
  if (!idParsed.success) return zodBadRequest(res, idParsed.error);
  const { id } = idParsed.data;

  const bodyParsed = zActUpdate.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
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
          errors: bodyParsed.error.issues?.map((i) => ({
            path: i.path,
            message: i.message,
            code: i.code,
            expected: (i as any).expected,
            received: (i as any).received,
          })),
        })
      );
  }

  const updateBody = clean({
    ...toWire(bodyParsed.data),
    dateLastUpdated: new Date().toISOString(),
  });

  const doc = await repo.updateById(id, updateBody);
  if (!doc) return notFound(res);
  return respond(res, zActDto, toActDto(doc));
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  const result = await repo.deleteById(id);
  if (!result) return notFound(res);
  res.status(204).send();
});
