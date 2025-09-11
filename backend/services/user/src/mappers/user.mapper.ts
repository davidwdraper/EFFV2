// backend/services/user/src/mappers/user.mapper.ts
import type { HydratedDocument, FlattenMaps, Types } from "mongoose";
import type { UserDocument } from "../models/user.model";
import type { User } from "@shared/src/contracts/user.contract";

/**
 * Accept both hydrated and lean Mongoose documents.
 * v7 note: LeanDocument is not exported; use FlattenMaps<T> & {_id:ObjectId}.
 */
type UserDocHydrated = HydratedDocument<UserDocument>;
type UserDocLean = FlattenMaps<UserDocument> & { _id: Types.ObjectId };
export type UserDocLike = UserDocHydrated | UserDocLean;

const toIso = (d: unknown): string => {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === "string") return new Date(d).toISOString();
  return new Date(String(d)).toISOString();
};

export function dbToDomain(doc: UserDocLike): User {
  const anyDoc = doc as any;
  return {
    _id: String(anyDoc._id),
    email: String(anyDoc.email),
    firstname: String(anyDoc.firstname),
    middlename:
      anyDoc.middlename === undefined ? undefined : String(anyDoc.middlename),
    lastname: String(anyDoc.lastname),
    userStatus: Number(anyDoc.userStatus),
    userType: Number(anyDoc.userType),
    imageIds: Array.isArray(anyDoc.imageIds) ? anyDoc.imageIds.map(String) : [],
    userEntryId:
      anyDoc.userEntryId === undefined ? undefined : String(anyDoc.userEntryId),
    userOwnerId:
      anyDoc.userOwnerId === undefined ? undefined : String(anyDoc.userOwnerId),
    dateCreated: toIso(anyDoc.dateCreated),
    dateLastUpdated: toIso(anyDoc.dateLastUpdated),
  };
}

/**
 * Prepare DB payloads from (partial) domain objects.
 * Dates are converted to Date instances; repo/model set defaults when absent.
 */
export function domainToDb(partial: Partial<User>): Partial<UserDocument> {
  const out: any = {};
  if (partial.email !== undefined) out.email = partial.email;
  if (partial.firstname !== undefined) out.firstname = partial.firstname;
  if (partial.middlename !== undefined) out.middlename = partial.middlename;
  if (partial.lastname !== undefined) out.lastname = partial.lastname;
  if (partial.userStatus !== undefined) out.userStatus = partial.userStatus;
  if (partial.userType !== undefined) out.userType = partial.userType;
  if (partial.imageIds !== undefined) out.imageIds = partial.imageIds;
  if (partial.userEntryId !== undefined) out.userEntryId = partial.userEntryId;
  if (partial.userOwnerId !== undefined) out.userOwnerId = partial.userOwnerId;
  if (partial.dateCreated) out.dateCreated = new Date(partial.dateCreated);
  if (partial.dateLastUpdated)
    out.dateLastUpdated = new Date(partial.dateLastUpdated);
  return out;
}
