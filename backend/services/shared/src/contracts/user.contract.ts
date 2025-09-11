// backend/services/shared/contracts/user.contract.ts
import { z } from "zod";
import { zObjectId, zIsoDate } from "./common";

/**
 * Canonical User domain object (source of truth).
 * All other shapes (DTOs, model mappings) derive from this.
 */
export const zUser = z.object({
  _id: zObjectId,
  email: z.string().email(),
  firstname: z.string().min(1),
  middlename: z.string().optional(),
  lastname: z.string().min(1),
  userStatus: z.number().int(),
  userType: z.number().int(),
  imageIds: z.array(z.string()).default([]),
  userEntryId: z.string().optional(),
  userOwnerId: z.string().optional(),
  dateCreated: zIsoDate,
  dateLastUpdated: zIsoDate,
});
export type User = z.infer<typeof zUser>;

/**
 * Inputs
 * - Create requires password; not part of domain object returned to clients.
 * - Replace is a full document (no password) the API accepts for PUT.
 * - Patch is any subset of replace fields.
 */
export const zUserCreate = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstname: z.string().min(1),
  lastname: z.string().min(1),
  middlename: z.string().optional(),
});
export type UserCreate = z.infer<typeof zUserCreate>;

export const zUserReplace = z.object({
  email: z.string().email(),
  firstname: z.string().min(1),
  lastname: z.string().min(1),
  middlename: z.string().optional(),
  userStatus: z.number().int().optional(), // keep optional to preserve existing controller semantics
  userType: z.number().int().optional(),
  imageIds: z.array(z.string()).optional(),
});
export type UserReplace = z.infer<typeof zUserReplace>;

export const zUserPatch = zUserReplace.partial();
export type UserPatch = z.infer<typeof zUserPatch>;

// Back-compat type aliases (if any code still imports these names)
export const UserDTO = zUser;
export type UserDTO = User;
export const UserCreateInput = zUserCreate;
export type UserCreateInput = UserCreate;
