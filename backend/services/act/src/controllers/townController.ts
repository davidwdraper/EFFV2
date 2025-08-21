// backend/services/act/src/controllers/townController.ts
import type { RequestHandler, Request, Response, NextFunction } from "express";
import Town from "../models/Town";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /towns/ping  → mount check
export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, resource: "towns", ts: new Date().toISOString() });
});

// GET /towns/typeahead?q=Tam&limit=10
// Response: { count, data: [{ label, name, state, lat, lng, townId }] }
export const typeahead: RequestHandler = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limitNum = Number(req.query.limit ?? 10);
  const limit = Math.min(
    Math.max(Number.isFinite(limitNum) ? limitNum : 10, 1),
    50
  );

  if (q.length < 3) return res.status(200).json({ count: 0, data: [] });

  const rx = new RegExp("^" + esc(q), "i");
  const towns = await Town.find(
    { name: rx },
    { name: 1, state: 1, lat: 1, lng: 1 }
  )
    .limit(limit)
    .lean();

  const data = towns.map((t: any) => ({
    label: `${t.name}, ${t.state}`,
    name: t.name,
    state: t.state,
    lat: t.lat,
    lng: t.lng,
    townId: t._id?.toString(),
  }));

  res.status(200).json({ count: data.length, data });
});

// GET /towns?query=...&state=...&limit=...
// Response: array of { id, name, state, lat, lng }
export const list: RequestHandler = asyncHandler(async (req, res) => {
  const query =
    typeof req.query.query === "string" ? req.query.query.trim() : "";
  const state =
    typeof req.query.state === "string"
      ? req.query.state.trim().toUpperCase()
      : "";
  const limitNum = Number(req.query.limit ?? 10);
  const limit = Math.min(
    Math.max(Number.isFinite(limitNum) ? limitNum : 10, 1),
    50
  );

  const filter: any = {};
  if (query.length >= 1)
    filter.name = { $regex: "^" + esc(query), $options: "i" };
  if (state) filter.state = state;

  const towns = await Town.find(filter, { name: 1, state: 1, lat: 1, lng: 1 })
    .limit(limit)
    .lean();

  res.status(200).json(
    towns.map((t: any) => ({
      id: t._id?.toString(),
      name: t.name,
      state: t.state,
      lat: t.lat,
      lng: t.lng,
    }))
  );
});

// GET /towns/:id
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const t = await Town.findById(req.params.id, {
    name: 1,
    state: 1,
    lat: 1,
    lng: 1,
  }).lean();
  if (!t) return res.status(404).json({ error: "Not found" });
  res.json({
    id: t._id?.toString(),
    name: t.name,
    state: t.state,
    lat: t.lat,
    lng: t.lng,
  });
});
