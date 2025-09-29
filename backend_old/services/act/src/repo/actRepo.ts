// backend/services/act/src/repos/actRepo.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/act/REPO.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0027-entity-services-on-shared-createserviceapp-internal-only-s2s-no-edge-guardrails.md
 *
 * Why:
 * - Act repo with strict domain↔DB mapping and typed fallbacks:
 *   - Validate via shared contracts/mappers.
 *   - Ensure actLoc via provided coords → address geocode → Town fallback.
 *   - Keep Mongoose queries strongly typed with lean<T>().
 */

import axios from "axios";
import ActModel, { ActDocument } from "../models/Act";
import TownModel from "../models/Town";
import { dbToDomain, domainToDb } from "../mappers/act.mapper";

import { normalizeActName } from "@eff/shared/src/utils/normalizeActName";
import { s2sAuthHeader } from "@eff/shared/src/utils/s2s/s2sAuthHeader";

import type {
  CreateActDto,
  UpdateActDto,
  SearchByRadiusDto,
} from "../validators/act.dto";

import type { Town } from "@eff/shared/src/contracts/town.contract";
import type { Act } from "@eff/shared/src/contracts/act.contract";

type GeoPoint = { type: "Point"; coordinates: [number, number] };
type TownLoc = Pick<Town, "_id" | "loc">;
type ActLocFields = Pick<Act, "homeTownId" | "actLoc">;

const M_PER_MI = 1609.344;
const GATEWAY_CORE = process.env.GATEWAY_CORE_BASE_URL;

// ──────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ──────────────────────────────────────────────────────────────────────────────

function asOptString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Safely pick optional address fields without assuming DTO declares them. */
function pickAddressFields(src: unknown): {
  addressStreet1?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
} {
  const s = src as Record<string, unknown>;
  return {
    addressStreet1: asOptString(s.addressStreet1),
    addressCity: asOptString(s.addressCity),
    addressState: asOptString(s.addressState),
    addressZip: asOptString(s.addressZip),
  };
}

async function callGeoService(address: string): Promise<GeoPoint | null> {
  try {
    const headers = {
      "Content-Type": "application/json",
      ...s2sAuthHeader("act"),
    };
    const { data } = await axios.post(
      `${GATEWAY_CORE}/geo/resolve`,
      { address },
      { headers, timeout: 8000 }
    );

    if (data && Number.isFinite(data.lng) && Number.isFinite(data.lat)) {
      return {
        type: "Point",
        coordinates: [Number(data.lng), Number(data.lat)],
      };
    }
    return null;
  } catch {
    // Caller logs; we fall back to Town coords.
    return null;
  }
}

/**
 * Ensure we always have a proper GeoJSON point for actLoc.
 * 1. If provided and valid, return it.
 * 2. Else, if mailing address is present, call Geo service.
 * 3. Else, fall back to the town's coordinates.
 */
type EnsureActLocInput = {
  homeTownId: string;
  actLoc?: Partial<GeoPoint>;
  addressStreet1?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
};
async function ensureActLoc(input: EnsureActLocInput): Promise<GeoPoint> {
  const { actLoc } = input;

  // 1) Provided and valid
  if (
    actLoc &&
    actLoc.type === "Point" &&
    Array.isArray(actLoc.coordinates) &&
    actLoc.coordinates.length === 2 &&
    Number.isFinite(actLoc.coordinates[0]) &&
    Number.isFinite(actLoc.coordinates[1])
  ) {
    return {
      type: "Point",
      coordinates: [actLoc.coordinates[0], actLoc.coordinates[1]],
    };
  }

  // 2) If mailing address present → call Geo service
  const addr = [
    input.addressStreet1,
    input.addressCity,
    input.addressState,
    input.addressZip,
  ]
    .filter(Boolean)
    .join(", ")
    .trim();

  if (addr.length > 0) {
    const geo = await callGeoService(addr);
    if (geo) return geo;
  }

  // 3) Fallback to Town coords (typed lean)
  const town = await TownModel.findById(input.homeTownId)
    .select({ _id: 1, loc: 1 })
    .lean<TownLoc>()
    .exec();

  if (!town?.loc?.coordinates || town.loc.coordinates.length !== 2) {
    throw new Error("Missing town coordinates for fallback actLoc");
  }

  return {
    type: "Point",
    coordinates: [town.loc.coordinates[0], town.loc.coordinates[1]],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
export async function create(input: CreateActDto) {
  // Safely extract address fields and compute actLoc from the minimal subset
  const addr = pickAddressFields(input);

  const actLoc = await ensureActLoc({
    homeTownId: (input as any).homeTownId,
    actLoc: (input as any).actLoc as any,
    ...addr,
  });

  const doc = await ActModel.create({
    ...domainToDb({ ...(input as any), actLoc }),
    nameNormalized: normalizeActName((input as any).name),
  });

  return dbToDomain(doc as ActDocument);
}

export async function update(id: string, input: UpdateActDto) {
  const payload: Record<string, unknown> = domainToDb(input);

  if (input.name) {
    payload.nameNormalized = normalizeActName(input.name);
  }

  // If actLoc not explicitly set but town/address may have changed, refresh
  if (
    !input.actLoc &&
    (input.homeTownId ||
      input.addressStreet1 ||
      input.addressCity ||
      input.addressState ||
      input.addressZip)
  ) {
    // ↓↓↓ Typed lean keeps current.homeTownId & current.actLoc available
    const current = await ActModel.findById(id)
      .select({ homeTownId: 1, actLoc: 1 })
      .lean<ActLocFields>()
      .exec();
    if (!current) return null;

    const actLoc = await ensureActLoc({
      homeTownId: (input.homeTownId as string) || current.homeTownId,
      actLoc: current.actLoc as GeoPoint,
      ...pickAddressFields(input),
    });

    payload.actLoc = actLoc;
  }

  const updated = await ActModel.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
  return updated ? dbToDomain(updated as ActDocument) : null;
}

export async function findById(id: string) {
  const doc = await ActModel.findById(id);
  return doc ? dbToDomain(doc as ActDocument) : null;
}

export async function removeById(id: string) {
  const doc = await ActModel.findByIdAndDelete(id);
  return !!doc;
}

// ──────────────────────────────────────────────────────────────────────────────
export async function searchByRadius(q: SearchByRadiusDto) {
  const meters = q.maxMiles * M_PER_MI;
  const query: any = {
    actLoc: {
      $near: {
        $geometry: { type: "Point", coordinates: q.center },
        $maxDistance: meters,
      },
    },
  };

  if (q.actType) query.actType = { $in: q.actType };
  if (q.genre)
    query.genreList = { $elemMatch: { $regex: q.genre, $options: "i" } };
  if (q.nameLike) query.name = { $regex: q.nameLike, $options: "i" };

  const docs = await ActModel.find(query).limit(q.limit);
  return docs.map((d) => dbToDomain(d as ActDocument));
}
