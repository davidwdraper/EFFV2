// backend/services/user/src/repo/userRepo.ts
import mongoose from "mongoose";
import UserModel from "../models/user.model";

// Keep this repo thin. Model owns defaults/validation/dates.
// Repo just routes calls and ensures lean gets getters/virtuals.

export const isValidId = (id: string) => mongoose.isValidObjectId(id);

// Apply getters/virtuals so dates are ISO strings and `id` virtual exists.
// (Also ensures password stays stripped by transform.)
const L = { getters: true, virtuals: true } as const;

export function findAll() {
  return UserModel.find().lean(L);
}

export function findById(id: string) {
  return UserModel.findById(id).lean(L);
}

export function findByEmail(emailNorm: string) {
  return UserModel.findOne({ email: emailNorm }).lean(L);
}

export async function create(doc: any) {
  // doc is validated upstream; model sets dateCreated/dateLastUpdated defaults
  const created = await UserModel.create(doc);
  // Convert to plain object with getters/virtuals (ISO dates, id, no password)
  return created.toObject();
}

export function updateById(id: string, patch: any) {
  // Model pre('findOneAndUpdate') bumps dateLastUpdated
  return UserModel.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  }).lean(L);
}

export function deleteById(id: string) {
  return UserModel.findByIdAndDelete(id).lean(L);
}

/** Minimal projection used by public name lookup */
export function findNamesByIds(ids: string[]) {
  return UserModel.find(
    { _id: { $in: ids } },
    { _id: 1, firstname: 1, middlename: 1, lastname: 1 }
  ).lean(L);
}

/** Explicit opt-in to read hashed password (auth flow only) */
export function findByEmailWithPassword(emailNorm: string) {
  return UserModel.findOne({ email: emailNorm }).select("+password").lean();
}
