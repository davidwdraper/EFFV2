// backend/services/user/src/controllers/directoryController.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import { prefixRe } from "../lib/search";
import * as repo from "../repo/directoryRepo";
import { dbToDirectoryDiscovery } from "src/mappers/user.directory.mapper";

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

  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }

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
    repo.find(filter, limit, offset),
    repo.count(filter),
  ]);

  // No emails returned; only discovery data
  const safe = (items ?? []).map(dbToDirectoryDiscovery);

  res.json({ total, limit, offset, items: safe });
});
