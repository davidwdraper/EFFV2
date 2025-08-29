// backend/services/geo/src/mappers/geo.mapper.ts
import type { GeoResponse } from "@shared/contracts/geo.contract";

/**
 * Provider → domain mappers.
 * For Google, their result already matches our domain (lat/lng).
 * Keep this layer so we can swap providers later without touching controllers.
 */

type GoogleLoc = { lat: number; lng: number };

export function googleToDomain(loc: GoogleLoc): GeoResponse {
  return {
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    provider: "google",
  };
}
