// backend/services/act/src/controllers/actController.ts
import type { RequestHandler, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import ActModel from "../models/Act";
import { requireNumber } from "../../../shared/config/env";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const httpError = (res: Response, status: number, message: string) =>
  res.status(status).json({
    status,
    title: status >= 500 ? "Server Error" : "Bad Request",
    error: message,
  });

const validateObjectId = (res: Response, id: string | undefined) => {
  if (!id || !mongoose.isValidObjectId(id)) {
    httpError(res, 400, "Invalid id format");
    return false;
  }
  return true;
};

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameRegex = (q: string) => {
  const tokens = q.trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!tokens.length) return null;
  return new RegExp("^" + tokens.join(".*\\s*"), "i");
};
const milesToRadians = (miles: number) => miles / 3963.2;

const UNFILTERED_CUTOFF = requireNumber("ACT_SEARCH_UNFILTERED_CUTOFF");

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "act", ts: new Date().toISOString() });
});

export const list: RequestHandler = asyncHandler(async (req, res) => {
  const name = (req.query.name as string | undefined)?.trim();
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
    100
  );
  const offset = Math.max(
    parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  );

  const filter: Record<string, any> = {};
  if (name) filter.name = { $regex: new RegExp(escapeRe(name), "i") };

  const [items, total] = await Promise.all([
    ActModel.find(filter).skip(offset).limit(limit).lean(),
    ActModel.countDocuments(filter),
  ]);

  res.json({ total, limit, offset, items });
});

export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(res, id)) return;
  const doc = await ActModel.findById(id).lean();
  if (!doc) return httpError(res, 404, "Not found");
  res.json(doc);
});

// GET /acts/search?lat=&lng=&miles=&q=&limit=
export const search: RequestHandler = asyncHandler(async (req, res) => {
  const lat = n(req.query.lat);
  const lng = n(req.query.lng);
  const miles = n(req.query.miles);
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
    100
  );
  const q = (req.query.q as string | undefined)?.trim() || "";

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(miles) ||
    miles <= 0
  ) {
    return httpError(res, 400, "lat, lng, and positive miles are required");
  }

  const geoFilter = {
    homeTownLoc: {
      $geoWithin: { $centerSphere: [[lng, lat], milesToRadians(miles)] },
    },
  };

  const totalInRadius = await ActModel.countDocuments(geoFilter);

  if (totalInRadius <= UNFILTERED_CUTOFF) {
    const items = await ActModel.find(geoFilter).limit(limit).lean();
    return res.json({
      total: totalInRadius,
      limit,
      offset: 0,
      items,
      mode: "all-in-radius",
    });
  }

  if (!q) {
    return res.status(400).json({
      error: "Too many results in area; provide q for typeahead",
      total: totalInRadius,
      code: "NEEDS_QUERY",
    });
  }

  const re = nameRegex(q);
  const filter = re ? { ...geoFilter, name: { $regex: re } } : geoFilter;

  const [items, total] = await Promise.all([
    ActModel.find(filter).limit(limit).lean(),
    ActModel.countDocuments(filter),
  ]);

  return res.json({
    total,
    limit,
    offset: 0,
    items,
    mode: "typeahead",
    areaTotal: totalInRadius,
  });
});

// Compat alias: /acts/by-hometown uses same logic as search
export const byHometown: RequestHandler = search;

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.name) return httpError(res, 400, "name is required");
  if (!Array.isArray(body.actType) || body.actType.length === 0)
    return httpError(res, 400, "actType must be a non-empty array");
  if (!body.userCreateId || !body.userOwnerId)
    return httpError(res, 400, "userCreateId and userOwnerId are required");
  if (!body.homeTown || !body.homeTownId || !body.homeTownLoc)
    return httpError(
      res,
      400,
      "homeTown, homeTownId, and homeTownLoc are required"
    );

  const nowIso = new Date().toISOString();
  const toCreate = {
    ...body,
    email: body.email ?? undefined,
    dateCreated: body.dateCreated ?? nowIso,
    dateLastUpdated: nowIso,
  };
  const doc = await ActModel.create(toCreate);
  res.status(201).json(doc);
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(res, id)) return;
  const body = {
    ...(req.body || {}),
    dateLastUpdated: new Date().toISOString(),
  };
  const doc = await ActModel.findByIdAndUpdate(id, body, {
    new: true,
    runValidators: true,
  }).lean();
  if (!doc) return httpError(res, 404, "Not found");
  res.json(doc);
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validateObjectId(res, id)) return;
  const result = await ActModel.findByIdAndDelete(id).lean();
  if (!result) return httpError(res, 404, "Not found");
  res.status(204).send();
});
