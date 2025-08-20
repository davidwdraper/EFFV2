// backend/services/act/src/controllers/actController.ts

import type { RequestHandler, Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import ActModel from "../models/Act";

// Generic async wrapper that keeps Express types happy
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Small helper to throw HTTP errors (Problem+JSON shaped by global error handler)
function httpError(status: number, detail: string, title?: string): never {
  const err: any = new Error(detail);
  err.status = status;
  if (title) err.title = title;
  throw err;
}

function parsePositiveInt(v: unknown, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.floor(n));
}

function validateObjectId(id: string) {
  if (!mongoose.isValidObjectId(id))
    httpError(400, "Invalid id format", "Bad Request");
}

function isDupKey(err: any) {
  return (
    err && (err.code === 11000 || String(err?.message || "").includes("E11000"))
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Controllers (typed as RequestHandler so return types don't fight TS)
// ───────────────────────────────────────────────────────────────────────────────

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "act", ts: new Date().toISOString() });
});

export const list: RequestHandler = asyncHandler(async (req, res) => {
  const name = (req.query.name as string | undefined)?.trim();
  const limit = Math.min(
    Math.max(parsePositiveInt(req.query.limit ?? "20", 20), 1),
    100
  );
  const offset = parsePositiveInt(req.query.offset ?? "0", 0);

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
  validateObjectId(id);

  const doc = await ActModel.findById(id).lean();
  if (!doc) {
    httpError(404, "Act not found", "Not Found");
  }
  res.json(doc);
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body || {};

  // Required fields (align with model)
  if (!body.name || typeof body.name !== "string") {
    httpError(400, "name is required", "Bad Request");
  }
  if (!Array.isArray(body.actType) || body.actType.length === 0) {
    httpError(400, "actType must be a non-empty array", "Bad Request");
  }
  if (!body.userCreateId || !body.userOwnerId) {
    httpError(400, "userCreateId and userOwnerId are required", "Bad Request");
  }
  if (!body.homeTown || !body.homeTownId || !body.homeTownLoc) {
    httpError(
      400,
      "homeTown, homeTownId, and homeTownLoc are required",
      "Bad Request"
    );
  }

  const nowIso = new Date().toISOString();
  const toCreate = {
    ...body,
    email: body.email ?? undefined, // canonical field
    dateCreated: body.dateCreated ?? nowIso,
    dateLastUpdated: nowIso,
  };

  try {
    const doc = await ActModel.create(toCreate);
    // audit example (flushed by app middleware)
    req.audit?.push({ type: "create", model: "Act", id: String(doc._id) });
    res.status(201).json(doc);
  } catch (err: any) {
    if (isDupKey(err))
      httpError(409, "Act already exists (name, homeTownId)", "Conflict");
    throw err;
  }
});

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateObjectId(id);

  const body = { ...(req.body || {}) };
  body.dateLastUpdated = new Date().toISOString();

  try {
    const doc = await ActModel.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true,
    }).lean();

    if (!doc) {
      httpError(404, "Act not found", "Not Found");
    }

    // audit example
    req.audit?.push({ type: "update", model: "Act", id });

    res.json(doc);
  } catch (err: any) {
    if (isDupKey(err))
      httpError(409, "Act already exists (name, homeTownId)", "Conflict");
    throw err;
  }
});

export const remove: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateObjectId(id);

  const result = await ActModel.findByIdAndDelete(id).lean();
  if (!result) {
    httpError(404, "Act not found", "Not Found");
  }

  // audit example
  req.audit?.push({ type: "delete", model: "Act", id });

  res.status(204).send();
});
