// backend/services/shared/contracts/town.contract.ts
import { z } from "zod";

/**
 * Canonical Town contract (Zod-first).
 *
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - ADRs:
 *   - docs/adr/0027-entity-services-on-shared-createserviceapp-internal-only-s2s-no-edge-guardrails.md
 *
 * Why:
 * - Single source of truth for Town shape used across services (e.g., Act).
 * - Keep Mongoose models thin; validate with Zod at the boundary.
 *
 * Notes:
 * - `_id` is a STRING to align with `homeTownId:string` across services.
 * - `loc` is GeoJSON Point with `[lng, lat]`.
 */

export const townContract = z.object({
  _id: z.string().min(1), // e.g., "austin-tx" or FIPS-based id
  name: z.string().min(1), // "Austin"
  state: z.string().min(2).max(2), // "TX" (postal)
  lat: z.number(), // convenience numeric fields
  lng: z.number(),
  county: z.string().optional(),
  population: z.number().int().nonnegative().optional(),
  fips: z.string().optional(), // keep flexible; formats vary
  loc: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
  }),
});

export type Town = z.infer<typeof townContract>;
