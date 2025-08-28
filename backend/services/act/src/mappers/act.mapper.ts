// backend/services/act/src/mappers/act.mapper.ts
import type { Act } from "../../../shared/contracts/act.contract";
import type { ActDocument } from "../models/Act";

// Domain ↔ DB mappers. Keep thin; no business logic here.

export function dbToDomain(doc: ActDocument): Act {
  // Mongoose to plain object (toJSON honors virtuals if enabled)
  const o = doc.toObject({ getters: true });
  // Ensure required fields are present (runtime safety)
  return {
    _id: String(o._id),
    dateCreated: o.dateCreated,
    dateLastUpdated: o.dateLastUpdated,

    actStatus: o.actStatus,
    actType: o.actType,
    userCreateId: o.userCreateId,
    userOwnerId: o.userOwnerId,

    name: o.name,
    nameNormalized: o.nameNormalized,
    aliases: o.aliases,

    email: o.email,

    homeTown: o.homeTown,
    state: o.state,
    homeTownId: o.homeTownId,

    addressStreet1: o.addressStreet1,
    addressStreet2: o.addressStreet2,
    addressCity: o.addressCity,
    addressState: o.addressState,
    addressZip: o.addressZip,

    actLoc: o.actLoc,

    imageIds: o.imageIds ?? [],

    websiteUrl: o.websiteUrl,
    distanceWillingToTravel: o.distanceWillingToTravel,
    genreList: o.genreList,
    actDuration: o.actDuration,
    breakLength: o.breakLength,
    numberOfBreaks: o.numberOfBreaks,

    bookingNotes: o.bookingNotes,
    earliestStartTime: o.earliestStartTime,
    latestStartTime: o.latestStartTime,
    blackoutDays: o.blackoutDays,

    validatedBy: o.validatedBy ?? [],
    invalidatedBy: o.invalidatedBy ?? [],
  };
}

// For creates/updates we accept a partial Act (DTO-validated) and pass through.
// Any computed fields (nameNormalized, actLoc fallback) should be handled in repo/service.
export function domainToDb(partial: Partial<Act>): Record<string, unknown> {
  const o: Record<string, unknown> = { ...partial };
  // Never allow clients to set DB-managed fields directly
  delete o._id;
  delete o.dateCreated;
  delete o.dateLastUpdated;
  return o;
}
