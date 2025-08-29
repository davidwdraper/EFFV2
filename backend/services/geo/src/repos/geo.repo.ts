// backend/services/geo/src/repos/geo.repo.ts
import axios from "axios";
import type { GeoResponse } from "@shared/contracts/geo.contract";
import { googleToDomain } from "../mappers/geo.mapper";

/**
 * Provider-agnostic resolver.
 * Today: GOOGLE only (selected via GEO_PROVIDER).
 * Returns GeoResponse on success, or null when the provider finds no results.
 */
const GOOGLE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export async function resolve(address: string): Promise<GeoResponse | null> {
  const provider = (process.env.GEO_PROVIDER || "google").toLowerCase();

  if (provider !== "google") {
    throw new Error(`Unsupported GEO_PROVIDER: ${provider}`);
  }

  const apiKey = process.env.GEO_GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEO_GOOGLE_API_KEY");
  }

  const { data } = await axios.get(GOOGLE_URL, {
    params: { address, key: apiKey },
    timeout: 8000,
  });

  if (!data?.results?.length) return null;

  // Map provider payload → domain shape
  return googleToDomain(data.results[0].geometry.location);
}
