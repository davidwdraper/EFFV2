// backend/services/user/src/repo/userRepo.ts
import mongoose from "mongoose";
import UserModel from "../models/user.model";

export const isValidId = (id: string) => mongoose.isValidObjectId(id);

export function findAll() {
  return UserModel.find().lean();
}

export function findById(id: string) {
  return UserModel.findById(id).lean();
}

export function findByEmail(emailNorm: string) {
  return UserModel.findOne({ email: emailNorm }).lean();
}

export function create(doc: any) {
  return UserModel.create(doc);
}

export function updateById(id: string, patch: any) {
  return UserModel.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  }).lean();
}

export function deleteById(id: string) {
  return UserModel.findByIdAndDelete(id).lean();
}

/** Minimal projection used by public name lookup */
export function findNamesByIds(ids: string[]) {
  return UserModel.find(
    { _id: { $in: ids } },
    { _id: 1, firstname: 1, middlename: 1, lastname: 1 }
  ).lean();
}
