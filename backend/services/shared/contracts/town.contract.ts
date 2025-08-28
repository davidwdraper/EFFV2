// backend/services/shared/contracts/town.contract.ts
import { z } from "zod";

/**
 * Canonical Town contract (single source of truth).
 * `_id` is a STRING so services can reference towns by string IDs (e.g., FIPS or vendor key),
 * avoiding ObjectId typing mismatches (homeTownId is string everywhere).
 */

export const townLocSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
});

export const townContract = z.object({
  _id: z.string(), // string town id (not ObjectId)
  name: z.string().min(1), // "Austin"
  state: z.string().min(1), // "TX"
  lat: z.number(), // convenience (redundant with loc)
  lng: z.number(), // convenience (redundant with loc)
  county: z.string().optional(),
  population: z.number().int().optional(),
  fips: z.string().optional(),

  // GeoJSON source of truth for spatial queries
  loc: townLocSchema,
});

export type Town = z.infer<typeof townContract>;
