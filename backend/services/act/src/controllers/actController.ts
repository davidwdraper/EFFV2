// backend/services/act/src/controllers/actController.ts

import type { RequestHandler, Request, Response, NextFunction } from "express";
import ActModel from "../models/Act";

// Generic async wrapper that keeps Express types happy
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ───────────────────────────────────────────────────────────────────────────────
// Controllers (typed as RequestHandler so return types don't fight TS)
// ───────────────────────────────────────────────────────────────────────────────

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
  if (name) {
    filter.name = { $regex: name, $options: "i" };
  }

  const [items, total] = await Promise.all([
    ActModel.find(filter).skip(offset).limit(limit).lean(),
    ActModel.countDocuments(filter),
  ]);

  res.json({ total, limit, offset, items });
});

export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await ActModel.findById(id).lean();
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(doc);
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body || {};

  // Required fields (align with model)
  if (!body.name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!Array.isArray(body.actType) || body.actType.length === 0) {
    res.status(400).json({ error: "actType must be a non-empty array" });
    return;
  }
  if (!body.userCreateId || !body.userOwnerId) {
    res
      .status(400)
      .json({ error: "userCreateId and userOwnerId are required" });
    return;
  }
  if (!body.homeTown || !body.homeTownId || !body.homeTownLoc) {
    res
      .status(400)
      .json({ error: "homeTown, homeTownId, and homeTownLoc are required" });
    return;
  }

  const nowIso = new Date().toISOString();
  const toCreate = {
    ...body,
    email: body.email ?? undefined, // canonical field
    dateCreated: body.dateCreated ?? nowIso,
    dateLastUpdated: nowIso,
  };

  const doc = await ActModel.create(toCreate);
  res.status(201).json(doc);
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const body = { ...(req.body || {}) };

  // Bump last updated every PUT/PATCH
  body.dateLastUpdated = new Date().toISOString();

  const doc = await ActModel.findByIdAndUpdate(id, body, {
    new: true,
    runValidators: true,
  }).lean();

  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(doc);
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await ActModel.findByIdAndDelete(id).lean();
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).send();
});
