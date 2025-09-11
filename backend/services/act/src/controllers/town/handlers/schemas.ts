// backend/services/act/src/controllers/town/handlers/schemas.ts
import { z } from "zod";
import { zObjectId } from "@shared/src/contracts/objectId";

export const MAX_TYPEAHEAD_LIMIT = 5000;

export const zClampedLimit = (def: number, max: number) =>
  z
    .any()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return def;
      const n = Number(v);
      const i = Number.isFinite(n) ? Math.trunc(n) : def;
      return Math.min(max, Math.max(1, i));
    })
    .pipe(z.number().int().min(1).max(max));

export const zIdParam = z.object({ id: zObjectId });

export const zTypeaheadQuery = z.object({
  q: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(MAX_TYPEAHEAD_LIMIT).default(10),
});

export const zTypeaheadItem = z.object({
  label: z.string(),
  name: z.string(),
  state: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  townId: z.string().optional(),
});

export const zTypeaheadResponse = z.object({
  count: z.number(),
  data: z.array(zTypeaheadItem),
});

export const zListQuery = z.object({
  query: z.string().trim().default(""),
  state: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .default(""),
  limit: zClampedLimit(50, 500),
});

export const zTownListItem = z.object({
  id: z.string().optional(),
  name: z.string(),
  state: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});
