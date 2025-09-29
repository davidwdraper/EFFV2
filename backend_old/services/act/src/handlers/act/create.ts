// PATH: backend/services/act/src/handlers/act/create.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *
 * Why:
 * - Act calls Geo via the shared **callBySlug** helper (single source of truth).
 * - Keeps S2S headers, API versioning, and JSON body handling consistent with gateway.
 *
 * Env (names only; values in .env.*):
 * - GEO_SLUG=geo
 * - GEO_SLUG_API_VERSION=v1
 * - GEO_RESOLVE_PATH=/resolve
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import { createActDto } from "../../validators/act.dto";
import * as repo from "../../repo/actRepo";

// ──────────────────────────────────────────────────────────────────────────────
// Strict envs (fail fast)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
const GEO_SLUG = requireEnv("GEO_SLUG"); // e.g., geo
const GEO_SLUG_API_VERSION = requireEnv("GEO_SLUG_API_VERSION"); // e.g., v1
const GEO_RESOLVE_PATH = requireEnv("GEO_RESOLVE_PATH"); // e.g., /resolve

// ──────────────────────────────────────────────────────────────────────────────
type MailingAddress = {
  addr1?: string;
  addr2?: string;
  city?: string;
  state?: string;
  zip?: string;
};

async function geocodeFromMailingAddress(
  addr?: MailingAddress
): Promise<{ lat: number; lng: number } | null> {
  if (!addr || !addr.addr1 || !addr.city || !addr.state || !addr.zip)
    return null;

  const address = `${addr.addr1}, ${addr.city}, ${addr.state} ${addr.zip}`;

  const resp = await callBySlug<{ lat: number; lng: number }>(
    GEO_SLUG,
    GEO_SLUG_API_VERSION,
    {
      method: "POST",
      path: GEO_RESOLVE_PATH,
      timeoutMs: 2000,
      headers: { "content-type": "application/json" },
      body: { address },
    }
  );

  // Tolerate multiple S2SResponse shapes: {body}|{data}|{payload}
  const payload: any =
    (resp as any).body ??
    (resp as any).data ??
    (resp as any).payload ??
    undefined;

  const ok =
    typeof resp.status === "number"
      ? resp.status >= 200 && resp.status < 300
      : !!payload;

  if (
    ok &&
    payload &&
    typeof payload.lat === "number" &&
    typeof payload.lng === "number"
  ) {
    return { lat: payload.lat, lng: payload.lng };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[ActHandlers.create] enter");
  try {
    // ✅ Canonical DTO parse
    const dto = createActDto.parse(req.body) as any;

    // If actLoc missing but mailingAddress present, attempt Geo resolution
    const hasActLoc =
      dto?.actLoc &&
      dto.actLoc.type === "Point" &&
      Array.isArray(dto.actLoc.coordinates) &&
      dto.actLoc.coordinates.length === 2 &&
      typeof dto.actLoc.coordinates[0] === "number" &&
      typeof dto.actLoc.coordinates[1] === "number";

    if (!hasActLoc && dto?.mailingAddress) {
      try {
        const a = dto.mailingAddress as MailingAddress;
        if (a?.addr1 && a?.city && a?.state && a?.zip) {
          const ll = await geocodeFromMailingAddress(a);
          if (ll) {
            // GeoJSON = [lng, lat]
            dto.actLoc = { type: "Point", coordinates: [ll.lng, ll.lat] };
            dto.actLocSource = "geocode";
            logger.debug({ requestId, ll }, "[ActHandlers.create] geocode ok");
          } else {
            logger.warn(
              { requestId, addr: dto.mailingAddress },
              "[ActHandlers.create] geocode no result"
            );
          }
        }
      } catch (geoErr: any) {
        logger.warn(
          { requestId, err: geoErr?.message || String(geoErr) },
          "[ActHandlers.create] geocode fail"
        );
        // continue; repo may still derive or error with a clear message
      }
    }

    // Persist (repo may still derive remaining fields)
    const created = await repo.create(dto);

    // Audit
    (req as any).audit?.push({
      type: "ACT_CREATED",
      entity: "Act",
      entityId: created._id,
      data: { name: created.name, homeTownId: created.homeTownId },
    });

    logger.debug(
      { requestId, actId: created._id },
      "[ActHandlers.create] exit"
    );
    res.status(201).json(created);
  } catch (err) {
    logger.debug({ requestId, err }, "[ActHandlers.create] error");
    next(err);
  }
}

export default create;
