// backend/services/shared/contracts/geo.contract.ts
import { z } from "zod";

// ── Canonical Geo contract ───────────────────────────────────────────────────
export const zGeoRequest = z.object({
  address: z.string().min(3),
});

export type GeoRequest = z.infer<typeof zGeoRequest>;

export const zGeoResponse = z.object({
  lat: z.number(),
  lng: z.number(),
  provider: z.literal("google"),
});

export type GeoResponse = z.infer<typeof zGeoResponse>;
