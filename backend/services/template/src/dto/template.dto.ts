// backend/services/--template--/src/dto/actDto.ts
import { Types } from "mongoose";
import { clean } from "@shared/contracts/clean";

/**
 * Deep-normalize values for the wire:
 * - ObjectId -> hex string
 * - Date -> ISO string
 * - Recursively handle arrays/objects
 */
const isOid = (v: unknown): v is Types.ObjectId =>
  !!v && typeof v === "object" && v instanceof Types.ObjectId;

const isDate = (v: unknown): v is Date =>
  Object.prototype.toString.call(v) === "[object Date]";

export function toWire<T>(val: T): any {
  if (val == null) return val;
  if (isOid(val)) return (val as Types.ObjectId).toHexString();
  if (isDate(val)) return (val as Date).toISOString();
  if (Array.isArray(val)) return val.map(toWire);
  if (typeof val === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = toWire(v);
    }
    return out;
  }
  return val;
}

export function iso(v: any) {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Build Template response DTO after deep-normalizing the doc.
 * Matches the current Template contract fields (post-refactor).
 * NOTE:
 *  - `dateCreated`/`dateLastUpdated` are returned as ISO strings.
 *  - Includes `nameNormalized` and `normalizedActName` (alias) for clients.
 *  - Uses `actLoc` (GeoJSON Point), not the old `homeTownLoc`.
 */
export function toActDto(doc: any) {
  const w = toWire(doc) || {};

  return clean({
    // Identity & timestamps
    _id: w._id,
    dateCreated: w.dateCreated ?? iso(doc?.dateCreated),
    dateLastUpdated: w.dateLastUpdated ?? iso(doc?.dateLastUpdated),

    // Core
    actStatus: w.actStatus,
    actType: Array.isArray(w.actType) ? w.actType : undefined,
    userCreateId: w.userCreateId,
    userOwnerId: w.userOwnerId,

    // Names
    name: w.name,
    nameNormalized: w.nameNormalized, // canonical normalized name
    normalizedActName: w.nameNormalized, // alias for UI/tests
    aliases: Array.isArray(w.aliases) ? w.aliases : undefined,

    // Contact
    email: w.email ?? undefined,

    // Home (required trio)
    homeTown: w.homeTown,
    state: w.state,
    homeTownId: w.homeTownId,

    // Optional mailing address (if present, service should geocode → actLoc)
    addressStreet1: w.addressStreet1 ?? undefined,
    addressStreet2: w.addressStreet2 ?? undefined,
    addressCity: w.addressCity ?? undefined,
    addressState: w.addressState ?? undefined,
    addressZip: w.addressZip ?? undefined,

    // Spatial (always present on persisted docs)
    actLoc: w.actLoc, // { type:"Point", coordinates:[lng,lat] }

    // Assets
    imageIds: Array.isArray(w.imageIds) ? w.imageIds : [],

    // Public profile / booking
    websiteUrl: w.websiteUrl ?? undefined,
    distanceWillingToTravel: w.distanceWillingToTravel, // number (env defaulted in model)
    genreList: Array.isArray(w.genreList) ? w.genreList : undefined, // array of strings
    actDuration: w.actDuration, // hours (e.g., 3.5) per your rule
    breakLength: w.breakLength, // minutes
    numberOfBreaks: w.numberOfBreaks,

    bookingNotes: w.bookingNotes ?? undefined,
    earliestStartTime: w.earliestStartTime ?? undefined, // "HH:MM" or "HH:MM:SS"
    latestStartTime: w.latestStartTime ?? undefined,
    blackoutDays: Array.isArray(w.blackoutDays) ? w.blackoutDays : undefined,

    // Moderation fields
    validatedBy: Array.isArray(w.validatedBy) ? w.validatedBy : [],
    invalidatedBy: Array.isArray(w.invalidatedBy) ? w.invalidatedBy : [],
  });
}
