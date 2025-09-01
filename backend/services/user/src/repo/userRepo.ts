// backend/services/user/src/repo/userRepo.ts
import mongoose from "mongoose";
import UserModel from "../models/user.model";

export const isValidId = (id: string) => mongoose.isValidObjectId(id);

// Always apply getters/virtuals with lean so dates are ISO strings and `id` is present.
const L = { getters: true, virtuals: true };

export function findAll() {
  return UserModel.find().lean(L);
}

export function findById(id: string) {
  return UserModel.findById(id).lean(L);
}

export function findByEmail(emailNorm: string) {
  // model lowercases/normalizes on write; normalize caller input upstream if needed
  return UserModel.findOne({ email: emailNorm }).lean(L);
}

// Create returns the created document with ISO dates and id
export async function create(doc: any) {
  const created = await UserModel.create(doc);
  // convert via toObject to apply getters/virtuals consistently
  return created.toObject();
}

// Patch-style update (partial); dateLastUpdated is bumped by model hook
export function updateById(id: string, patch: any) {
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

/** Explicit opt-in path that needs hashed password (e.g., private login flow) */
export function findByEmailWithPassword(emailNorm: string) {
  return UserModel.findOne({ email: emailNorm }).select("+password").lean(); // no getters needed; caller knows what it's doing
}
