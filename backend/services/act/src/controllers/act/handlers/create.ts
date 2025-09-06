// backend/services/act/src/controllers/act/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import { logger } from "@shared/utils/logger";
import { createActDto } from "../../../validators/act.dto";
import * as repo from "../../../repo/actRepo";

// ──────────────────────────────────────────────────────────────────────────────
// Strict envs (fail fast; matches .env.dev you already have)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

const CORE_BASE_URL = requireEnv("GATEWAY_CORE_BASE_URL"); // e.g., http://127.0.0.1:4011
const S2S_JWT_SECRET = requireEnv("S2S_JWT_SECRET");
const S2S_JWT_ISSUER = requireEnv("S2S_JWT_ISSUER"); // should be "gateway-core" in dev
const S2S_JWT_AUDIENCE = requireEnv("S2S_JWT_AUDIENCE");

// Optional user assertion for core→geo hops if you ever need it from here.
// (Not used when caller provides actLoc; kept for completeness.)
const USER_ASSERTION_SECRET = process.env.USER_ASSERTION_SECRET || "";
const USER_ASSERTION_ISSUER =
  process.env.USER_ASSERTION_ISSUER || S2S_JWT_ISSUER || "gateway-core";
const USER_ASSERTION_AUDIENCE =
  process.env.USER_ASSERTION_AUDIENCE || "internal-users";

// ──────────────────────────────────────────────────────────────────────────────
// Mint S2S for Core/Geo
function mintS2S(ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "s2s",
    iss: S2S_JWT_ISSUER,
    aud: S2S_JWT_AUDIENCE,
    iat: now,
    exp: now + ttlSec,
    scope: "geo:resolve",
    svc: "act",
  } as const;
  return jwt.sign(payload, S2S_JWT_SECRET, { algorithm: "HS256" });
}

// Optional: end-user assertion when calling core/geo (only if your geo requires it)
function mintUserAssertion(sub = "act-service", ttlSec = 300): string | null {
  if (!USER_ASSERTION_SECRET) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    iss: USER_ASSERTION_ISSUER,
    aud: USER_ASSERTION_AUDIENCE,
    iat: now,
    exp: now + ttlSec,
    jti: require("node:crypto").randomUUID(),
  } as const;
  return jwt.sign(payload, USER_ASSERTION_SECRET, { algorithm: "HS256" });
}

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

  const s2s = mintS2S(300);
  const ua = mintUserAssertion("act-geocode", 300);

  const r = await axios.post(
    `${CORE_BASE_URL}/api/geo/resolve`,
    { address: `${addr.addr1}, ${addr.city}, ${addr.state} ${addr.zip}` },
    {
      timeout: 2000,
      headers: {
        Authorization: `Bearer ${s2s}`,
        "Content-Type": "application/json",
        ...(ua ? { "X-NV-User-Assertion": ua } : {}),
      },
      validateStatus: () => true,
    }
  );

  if (
    r.status >= 200 &&
    r.status < 300 &&
    r.data &&
    typeof r.data.lat === "number" &&
    typeof r.data.lng === "number"
  ) {
    return { lat: r.data.lat, lng: r.data.lng };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[ActHandlers.create] enter");
  try {
    // ✅ Single-way: schema constant → .parse()
    const dto = createActDto.parse(req.body) as any;

    // If actLoc missing but mailingAddress is present, try Geo FIRST
    const hasActLoc =
      dto?.actLoc &&
      dto.actLoc.type === "Point" &&
      Array.isArray(dto.actLoc.coordinates) &&
      dto.actLoc.coordinates.length === 2 &&
      typeof dto.actLoc.coordinates[0] === "number" &&
      typeof dto.actLoc.coordinates[1] === "number";

    if (!hasActLoc && dto?.mailingAddress) {
      try {
        const ll = await geocodeFromMailingAddress(dto.mailingAddress);
        if (ll) {
          dto.actLoc = { type: "Point", coordinates: [ll.lng, ll.lat] }; // GeoJSON = [lng, lat]
          dto.actLocSource = "geocode";
          logger.debug({ requestId, ll }, "[ActHandlers.create] geocode ok");
        } else {
          logger.warn(
            { requestId, addr: dto.mailingAddress },
            "[ActHandlers.create] geocode no result"
          );
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
