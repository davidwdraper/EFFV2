// backend/services/geo/src/validators/geo.dto.ts
import { z } from "zod";
import {
  zGeoRequest,
  zGeoResponse,
  type GeoRequest,
  type GeoResponse,
} from "@shared/contracts/geo.contract";

/**
 * DTOs for Geo service.
 * We mirror the shared contract (source of truth) so controllers
 * can import locally without redefining shapes.
 */
export const resolveRequestDto = zGeoRequest;
export type ResolveRequestDto = GeoRequest;

export const resolveResponseDto = zGeoResponse;
export type ResolveResponseDto = GeoResponse;

// If you later add more endpoints, define specific DTOs here via .pick()/.omit().
