// backend/services/act/src/dto/actDto.ts
import { Types } from "mongoose";
import { clean } from "@shared/contracts";

/** Deep-normalize: ObjectId -> hex string, Date -> ISO string (recursive) */
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

/** Build Act DTO after deep-normalizing the doc */
export function toActDto(doc: any) {
  const w = toWire(doc) || {};
  return clean({
    _id: w._id,
    dateCreated: w.dateCreated ?? iso(doc?.dateCreated),
    dateLastUpdated: w.dateLastUpdated ?? iso(doc?.dateLastUpdated),
    actStatus: w.actStatus,
    actType: Array.isArray(w.actType) ? w.actType : undefined,
    userCreateId: w.userCreateId,
    userOwnerId: w.userOwnerId,
    name: w.name,
    email: w.email ?? undefined,
    imageIds: Array.isArray(w.imageIds) ? w.imageIds : undefined,
    homeTown: w.homeTown,
    homeTownId: w.homeTownId,
    homeTownLoc: w.homeTownLoc,
    websiteUrl: w.websiteUrl ?? undefined,
    distanceWillingToTravel: w.distanceWillingToTravel ?? undefined,
    genreList: Array.isArray(w.genreList) ? w.genreList : undefined,
    actDuration: w.actDuration ?? undefined,
    breakLength: w.breakLength ?? undefined,
    numberOfBreaks: w.numberOfBreaks ?? undefined,
    bookingNotes: w.bookingNotes ?? undefined,
    earliestStartTime: w.earliestStartTime ?? undefined,
    latestStartTime: w.latestStartTime ?? undefined,
    blackoutDays: Array.isArray(w.blackoutDays) ? w.blackoutDays : undefined,
  });
}
