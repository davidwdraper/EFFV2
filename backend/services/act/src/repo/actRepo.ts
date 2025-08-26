// backend/services/act/src/repo/actRepo.ts
import { Types } from "mongoose";
import ActModel from "../models/Act";

export function list(
  filter: Record<string, any>,
  limit: number,
  offset: number
) {
  return ActModel.find(filter).skip(offset).limit(limit).lean();
}

export function count(filter: Record<string, any>) {
  return ActModel.countDocuments(filter);
}

export function findById(id: string) {
  return ActModel.findById(id).lean();
}

export function find(
  filter: Record<string, any>,
  limit: number,
  offset: number
) {
  return ActModel.find(filter).skip(offset).limit(limit).lean();
}

export function findAll(
  filter: Record<string, any>,
  limit: number,
  offset: number
) {
  return ActModel.find(filter).skip(offset).limit(limit).lean();
}

export function upsertByNameAndHometown(
  name: string,
  homeTownId: string,
  toInsert: any
) {
  const filter = {
    name,
    homeTownId: /^[a-f\d]{24}$/i.test(homeTownId)
      ? new Types.ObjectId(homeTownId)
      : homeTownId,
  } as const;

  return ActModel.findOneAndUpdate(
    filter,
    { $setOnInsert: toInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

export function create(doc: any) {
  return ActModel.create(doc);
}

export function findByName(name: string) {
  return ActModel.findOne({ name }).lean();
}

export function updateById(id: string, updateBody: any) {
  return ActModel.findByIdAndUpdate(id, updateBody, {
    new: true,
    runValidators: true,
  }).lean();
}

export function deleteById(id: string) {
  return ActModel.findByIdAndDelete(id).lean();
}
