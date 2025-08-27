// backend/services/act/src/repo/actRepo.ts
import { Types } from "mongoose";
import ActModel from "../models/Act";

// Conservative helper for explicit ObjectId casting where needed.
function asObjectId(id: string | Types.ObjectId) {
  if (id instanceof Types.ObjectId) return id;
  if (typeof id === "string" && /^[a-f\d]{24}$/i.test(id)) {
    return new Types.ObjectId(id);
  }
  return id as any;
}

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

export function findById(id: string | Types.ObjectId) {
  // Let Mongoose cast the incoming string id
  return ActModel.findById(id as any).lean();
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

export function updateById(id: string | Types.ObjectId, updateBody: any) {
  // Let Mongoose cast the incoming string id
  return ActModel.findByIdAndUpdate(id as any, updateBody, {
    new: true,
    runValidators: true,
  }).lean();
}

/**
 * Deterministic delete:
 * 1) Try findByIdAndDelete(id) so Mongoose handles casting and returns the removed doc.
 * 2) If null, fall back to deleteOne({_id}) with explicit ObjectId cast and
 *    consider success when deletedCount > 0 (return a truthy marker).
 */
export async function deleteById(id: string | Types.ObjectId) {
  const removed = await ActModel.findByIdAndDelete(id as any).lean();
  if (removed) return removed as any;

  const _id = asObjectId(id);
  const res = await ActModel.deleteOne({ _id });
  if ((res as any)?.deletedCount > 0) {
    return { _id } as any;
  }
  return null;
}
