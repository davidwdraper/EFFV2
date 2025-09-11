// backend/services/geo/src/controllers/geo/handlers/geo.resolve.ts
import type { Request, Response, NextFunction } from "express";
import axios from "axios";
import { logger } from "../../../../../shared/utils/logger";
import { zGeoRequest, zGeoResponse } from "@shared/src/contracts/geo.contract";
import { respond, zodBadRequest } from "@shared/src/contracts/http";
import { googleToDomain } from "../../../mappers/geo.mapper";

const GOOGLE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * POST /geo/resolve
 * Body: { address: string }
 * 200: { lat, lng, provider }
 * 404: Problem JSON when no results
 */
export async function geoResolve(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId, body: req.body }, "[geo.resolve] enter");

  // Validate request
  const parsed = zGeoRequest.safeParse(req.body);
  if (!parsed.success) {
    return zodBadRequest(res, parsed.error, requestId);
  }

  try {
    const { address } = parsed.data;

    const { data } = await axios.get(GOOGLE_URL, {
      params: {
        address,
        key: process.env.GEO_GOOGLE_API_KEY,
      },
      timeout: 8000,
    });

    if (!data?.results?.length) {
      logger.warn(
        { requestId, address, status: data?.status },
        "[geo.resolve] no results from provider"
      );
      return respond(res, 404, {
        code: "NOT_FOUND",
        message: "No geocode results",
        status: 404,
        requestId,
        details: { address, providerStatus: data?.status },
      });
    }

    // Map provider -> domain and validate response shape
    const out = zGeoResponse.parse(
      googleToDomain(data.results[0].geometry.location)
    );

    // Audit (buffered; flushed by middleware)
    (req as any).audit?.push({
      type: "GEO_RESOLVED",
      entity: "Geo",
      entityId: undefined,
      data: { address, ...out },
    });

    logger.debug({ requestId, out }, "[geo.resolve] exit");
    return respond(res, 200, out);
  } catch (err) {
    logger.error({ requestId, err }, "[geo.resolve] error");
    next(err);
  }
}
