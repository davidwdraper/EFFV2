// backend/services/act/src/repos/actRepo.ts
import ActModel, { ActDocument } from "../models/Act";
import TownModel from "../models/Town";
import { dbToDomain, domainToDb } from "../mappers/act.mapper";
import { normalizeActName } from "../../../shared/utils/normalizeActName";
import axios from "axios";
import { s2sAuthHeader } from "@shared/utils/s2s";

import type {
  CreateActDto,
  UpdateActDto,
  SearchByRadiusDto,
} from "../validators/act.dto";

type GeoPoint = { type: "Point"; coordinates: [number, number] };
const M_PER_MI = 1609.344;
const GATEWAY_CORE = process.env.GATEWAY_CORE_BASE_URL;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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
  } catch (err) {
    // Log at caller — swallow here for fallback
    return null;
  }
}

// Ensure we always have a proper GeoJSON point for actLoc.
// 1. If provided and valid, return it.
// 2. Else, if mailing address is present, call Geo service.
// 3. Else, fall back to the town's coordinates.
async function ensureActLoc<
  T extends {
    homeTownId: string;
    actLoc?: Partial<GeoPoint>;
    addressStreet1?: string;
    addressCity?: string;
    addressState?: string;
    addressZip?: string;
  }
>(dto: T): Promise<Omit<T, "actLoc"> & { actLoc: GeoPoint }> {
  // Provided and valid
  if (
    dto.actLoc &&
    dto.actLoc.type === "Point" &&
    Array.isArray(dto.actLoc.coordinates) &&
    dto.actLoc.coordinates.length === 2 &&
    Number.isFinite(dto.actLoc.coordinates[0]) &&
    Number.isFinite(dto.actLoc.coordinates[1])
  ) {
    return dto as any;
  }

  // If mailing address present → call Geo service
  const addr = [
    dto.addressStreet1,
    dto.addressCity,
    dto.addressState,
    dto.addressZip,
  ]
    .filter(Boolean)
    .join(", ")
    .trim();

  if (addr.length > 0) {
    const geo = await callGeoService(addr);
    if (geo) {
      const { actLoc: _ignore, ...rest } = dto as any;
      return { ...rest, actLoc: geo };
    }
  }

  // Fallback to Town coords
  const town = await TownModel.findById(dto.homeTownId).lean();
  if (!town?.loc?.coordinates) {
    throw new Error("Missing town coordinates for fallback actLoc");
  }

  const actLoc: GeoPoint = {
    type: "Point",
    coordinates: [town.loc.coordinates[0], town.loc.coordinates[1]],
  };

  const { actLoc: _ignore, ...rest } = dto as any;
  return { ...rest, actLoc };
}

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

export async function create(input: CreateActDto) {
  const withLoc = await ensureActLoc(input);
  const doc = await ActModel.create({
    ...domainToDb(withLoc),
    nameNormalized: normalizeActName(withLoc.name),
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
    const current = await ActModel.findById(id).lean();
    if (!current) return null;

    const refreshed = await ensureActLoc({
      homeTownId: (input.homeTownId as string) || current.homeTownId,
      actLoc: current.actLoc as GeoPoint,
      addressStreet1: input.addressStreet1,
      addressCity: input.addressCity,
      addressState: input.addressState,
      addressZip: input.addressZip,
    });
    payload.actLoc = refreshed.actLoc;
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
