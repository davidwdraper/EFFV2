// backend/services/act/src/controllers/actController.ts
import type { RequestHandler, Request, Response, NextFunction } from "express";
import ActModel from "../models/Act";
import { requireNumber } from "../../../shared/config/env";
import { z } from "zod";
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

// ── Async handler ─────────────────────────────────────────────────────────────
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const notFound = (res: Response) =>
  res.status(404).json({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: "Resource not found",
  });

const badRequestMsg = (
  res: Response,
  detail: string,
  extra?: Record<string, unknown>
) =>
  res.status(400).json(
    clean({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail,
      ...extra,
    })
  );

// ── Env ───────────────────────────────────────────────────────────────────────
const UNFILTERED_CUTOFF = requireNumber("ACT_SEARCH_UNFILTERED_CUTOFF");

// ── Helpers ───────────────────────────────────────────────────────────────────
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRegex = (q: string) => {
  const tokens = q.trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!tokens.length) return null;
  return new RegExp("^" + tokens.join(".*\\s*"), "i");
};
const milesToRadians = (miles: number) => miles / 3963.2;

const zIdParam = z.object({ id: zObjectId });
const zListQuery = zPagination.extend({
  name: z.string().trim().min(1).max(200).optional(),
});

const oid = (v: any) =>
  v == null ? undefined : typeof v === "string" ? v : v.toString();
const iso = (v: any) => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

function toActDto(doc: any) {
  return clean({
    _id: oid(doc._id)!,
    dateCreated: iso(doc.dateCreated),
    dateLastUpdated: iso(doc.dateLastUpdated),
    actStatus: doc.actStatus,
    actType: Array.isArray(doc.actType) ? doc.actType : undefined,
    userCreateId: oid(doc.userCreateId),
    userOwnerId: oid(doc.userOwnerId),
    name: doc.name,
    email: doc.email ?? undefined,
    imageIds: Array.isArray(doc.imageIds)
      ? doc.imageIds.map(oid).filter(Boolean)
      : undefined,
    homeTown: doc.homeTown,
    homeTownId: doc.homeTownId,
    homeTownLoc: doc.homeTownLoc,
    websiteUrl: doc.websiteUrl ?? undefined,
    distanceWillingToTravel: doc.distanceWillingToTravel ?? undefined,
    genreList: Array.isArray(doc.genreList) ? doc.genreList : undefined,
    actDuration: doc.actDuration ?? undefined,
    breakLength: doc.breakLength ?? undefined,
    numberOfBreaks: doc.numberOfBreaks ?? undefined,
    bookingNotes: doc.bookingNotes ?? undefined,
    earliestStartTime: doc.earliestStartTime ?? undefined,
    latestStartTime: doc.latestStartTime ?? undefined,
    blackoutDays: Array.isArray(doc.blackoutDays)
      ? doc.blackoutDays
      : undefined,
  });
}

function listDto(items: any[], limit: number, offset: number, total: number) {
  return { total, limit, offset, items: items.map(toActDto) };
}

// ── Handlers ─────────────────────────────────────────────────────────────────
export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "act", ts: new Date().toISOString() });
});

export const list: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zListQuery.safeParse(req.query);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { name, limit, offset } = parsed.data;

  const filter: Record<string, any> = {};
  if (name) filter.name = { $regex: new RegExp(escapeRe(name), "i") };

  const [rows, total] = await Promise.all([
    ActModel.find(filter).skip(offset).limit(limit).lean(),
    ActModel.countDocuments(filter),
  ]);

  return respond(res, zActListDto, listDto(rows, limit, offset, total));
});

export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  const doc = await ActModel.findById(id).lean();
  if (!doc) return notFound(res);
  return respond(res, zActDto, toActDto(doc));
});

// GET /acts/search (and /acts/by-hometown)
export const search: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActByHometownQuery.safeParse(req.query);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { lat, lng, miles, q, limit, offset } = parsed.data;

  const geoFilter = {
    homeTownLoc: {
      $geoWithin: { $centerSphere: [[lng, lat], milesToRadians(miles)] },
    },
  };

  const totalInRadius = await ActModel.countDocuments(geoFilter);

  if (totalInRadius <= UNFILTERED_CUTOFF) {
    const items = await ActModel.find(geoFilter)
      .skip(offset)
      .limit(limit)
      .lean();
    return respond(
      res,
      zActListDto,
      clean({
        ...listDto(items, limit, offset, totalInRadius),
        mode: "all-in-radius",
      })
    );
  }

  if (!q) {
    return badRequestMsg(
      res,
      "Too many results in area; provide q for typeahead",
      {
        code: "NEEDS_QUERY",
        total: totalInRadius,
      }
    );
  }

  const re = nameRegex(q);
  const filter = re ? { ...geoFilter, name: { $regex: re } } : geoFilter;

  const [items, total] = await Promise.all([
    ActModel.find(filter).skip(offset).limit(limit).lean(),
    ActModel.countDocuments(filter),
  ]);

  return respond(
    res,
    zActListDto,
    clean({
      ...listDto(items, limit, offset, total),
      mode: "typeahead",
      areaTotal: totalInRadius,
    })
  );
});

export const byHometown: RequestHandler = search;

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActCreate.safeParse(req.body ?? {});
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const body = parsed.data;

  const nowIso = new Date().toISOString();
  const toCreate = clean({
    ...body,
    dateCreated: (body as any).dateCreated ?? nowIso,
    dateLastUpdated: nowIso,
  });

  const doc = await ActModel.create(toCreate);
  const json =
    typeof (doc as any).toObject === "function"
      ? (doc as any).toObject()
      : (doc as any);
  return respond(res, zActDto, toActDto(json), 201);
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const idParsed = zIdParam.safeParse(req.params);
  if (!idParsed.success) return zodBadRequest(res, idParsed.error);
  const { id } = idParsed.data;

  const bodyParsed = zActUpdate.safeParse(req.body ?? {});
  if (!bodyParsed.success) return zodBadRequest(res, bodyParsed.error);

  const updateBody = clean({
    ...bodyParsed.data,
    dateLastUpdated: new Date().toISOString(),
  });

  const doc = await ActModel.findByIdAndUpdate(id, updateBody, {
    new: true,
    runValidators: true,
  }).lean();
  if (!doc) return notFound(res);
  return respond(res, zActDto, toActDto(doc));
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  const result = await ActModel.findByIdAndDelete(id).lean();
  if (!result) return notFound(res);
  res.status(204).send();
});
