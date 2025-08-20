// backend/services/user/src/controllers/directoryController.ts
import type { RequestHandler, Request, Response, NextFunction } from "express";
import Directory from "../models/Directory";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function prefixRe(term: string) {
  const t = String(term || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .toLowerCase()
    .trim();
  return new RegExp("^" + t);
}

function httpError(status: number, detail: string, title?: string): never {
  const err: any = new Error(detail);
  err.status = status;
  if (title) err.title = title;
  throw err;
}

// GET /directory/search?q=Jane%20Sm&limit=20&offset=0
export const search: RequestHandler = asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
    50
  );
  const offset = Math.max(
    parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  );
  if (!q) httpError(400, "q is required", "Bad Request");

  const tokens = q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t.toLowerCase());

  let filter: any;
  if (tokens.length >= 2) {
    const [a, b] = tokens;
    filter = {
      $or: [
        { givenFold: prefixRe(a), familyFold: prefixRe(b) },
        { givenFold: prefixRe(b), familyFold: prefixRe(a) },
      ],
    };
  } else {
    const [a] = tokens;
    filter = {
      $or: [
        { givenFold: prefixRe(a) },
        { familyFold: prefixRe(a) },
        { nameFold: prefixRe(a) },
      ],
    };
  }

  const [items, total] = await Promise.all([
    Directory.find(filter).skip(offset).limit(limit).lean(),
    Directory.countDocuments(filter),
  ]);

  // No emails returned; only discovery data
  const safe = items.map((d) => ({
    id: d.userId,
    name: [d.givenName, d.familyName].filter(Boolean).join(" "),
    city: d.city,
    state: d.state,
    country: d.country,
    bucket: d.bucket,
  }));

  res.json({ total, limit, offset, items: safe });
});
