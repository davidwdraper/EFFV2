// backend/services/act/src/controllers/townController.ts
import type { RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zodBadRequest, zObjectId, clean, respond } from "@shared/contracts";
import { notFound } from "@shared/http/errors";
import { escapeRe } from "../lib/search";
import * as repo from "../repo/townRepo";
import { toTownListItem, toTownTypeaheadItem } from "../dto/townDTO";

// ── Limits (prod-only value; tests must not rely on gating here) ──────────────
const MAX_TYPEAHEAD_LIMIT = 5000;

// ── Zod helpers for clamped limits ────────────────────────────────────────────
const zClampedLimit = (def: number, max: number) =>
  z
    .any()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return def;
      const n = Number(v);
      const i = Number.isFinite(n) ? Math.trunc(n) : def;
      return Math.min(max, Math.max(1, i));
    })
    .pipe(z.number().int().min(1).max(max));

// ── Schemas ───────────────────────────────────────────────────────────────────
const zIdParam = z.object({ id: zObjectId });

const zTypeaheadQuery = z.object({
  q: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(MAX_TYPEAHEAD_LIMIT).default(10),
});

const zTypeaheadItem = z.object({
  label: z.string(),
  name: z.string(),
  state: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  townId: z.string().optional(),
});

const zTypeaheadResponse = z.object({
  count: z.number(),
  data: z.array(zTypeaheadItem),
});

const zListQuery = z.object({
  query: z.string().trim().default(""),
  state: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .default(""),
  limit: zClampedLimit(50, 500),
});

const zTownListItem = z.object({
  id: z.string().optional(),
  name: z.string(),
  state: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

// ── Handlers ─────────────────────────────────────────────────────────────────

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, resource: "towns", ts: new Date().toISOString() });
});

// GET /towns/typeahead?q=Tam&limit=...
export const typeahead: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zTypeaheadQuery.safeParse(req.query);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { q, limit } = parsed.data;

  if (!q || q.length < 3) {
    return respond(res, zTypeaheadResponse, clean({ count: 0, data: [] }));
  }

  // Clamp valid-but-high limits to 50 for the actual query
  const effectiveLimit = Math.min(limit, 50);

  const rx = new RegExp(escapeRe(q), "i");
  const towns = await repo.find(
    {
      $or: [
        { name: rx },
        {
          /* label: reserve for future expansion */
        },
        {
          /* city: reserve for future expansion */
        },
      ],
    },
    { name: 1, state: 1, lat: 1, lng: 1 },
    { name: 1 },
    effectiveLimit
  );

  const data = (towns ?? []).map(toTownTypeaheadItem);
  return respond(res, zTypeaheadResponse, clean({ count: data.length, data }));
});

// GET /towns?query=...&state=...&limit=...
export const list: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zListQuery.safeParse(req.query);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { query, state, limit } = parsed.data;

  const projection = { name: 1, state: 1, lat: 1, lng: 1 } as const;

  // Base filter: prefix OR contains on `name`
  const filter: Record<string, any> = {};
  if (query && query.length >= 1) {
    const starts = new RegExp("^" + escapeRe(query), "i");
    const contains = new RegExp(escapeRe(query), "i");
    filter.$or = [{ name: starts }, { name: contains }];
  }
  if (state) filter.state = state;

  let towns = await repo.find(filter, projection, { name: 1 }, limit);

  // Fallback 1: if nothing found but query exists, try **all** alpha tokens (≥3 chars) as contains
  if ((towns?.length ?? 0) === 0 && query) {
    const tokens = query.match(/[A-Za-z]{3,}/g) || [];
    for (const tok of tokens) {
      const rx = new RegExp(escapeRe(tok), "i");
      const relaxed = await repo.find(
        { ...(state ? { state } : {}), name: rx },
        projection,
        { name: 1 },
        limit
      );
      if (relaxed.length) {
        towns = relaxed;
        break;
      }
    }
  }

  // Fallback 2: still nothing? Return a small unfiltered slice (respects state & limit)
  if ((towns?.length ?? 0) === 0) {
    towns = await repo.find(
      state ? { state } : {},
      projection,
      { name: 1 },
      limit
    );
  }

  const payload = (towns ?? []).map(toTownListItem);
  return respond(res, z.array(zTownListItem), payload);
});

// GET /towns/:id
export const getById: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIdParam.safeParse(req.params);
  if (!parsed.success) return zodBadRequest(res, parsed.error);
  const { id } = parsed.data;

  const t = await repo.findById(id, { name: 1, state: 1, lat: 1, lng: 1 });
  if (!t) return notFound(res);

  return respond(res, zTownListItem, toTownListItem(t));
});
