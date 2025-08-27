// backend/services/act/src/repo/actRepo.ts
import { Types } from "mongoose";
import ActModel, { ActDocument } from "../models/Act";

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
  return ActModel.find(filter)
    .sort({ _id: 1 })
    .skip(offset)
    .limit(limit)
    .lean();
}

export function count(filter: Record<string, any>) {
  return ActModel.countDocuments(filter);
}

export function findAll(
  filter: Record<string, any>,
  limit: number,
  offset: number
) {
  return ActModel.find(filter)
    .sort({ _id: 1 })
    .skip(offset)
    .limit(limit)
    .lean();
}

export function findById(id: string | Types.ObjectId) {
  return ActModel.findById(id as any).lean();
}

export function findByName(name: string) {
  return ActModel.findOne({ name }).lean();
}

export async function create(doc: Partial<ActDocument>) {
  // Ignore any client-supplied timestamps; server owns them.
  if ("dateCreated" in (doc as any)) delete (doc as any).dateCreated;
  if ("dateLastUpdated" in (doc as any)) delete (doc as any).dateLastUpdated;

  const created = new ActModel(doc as any);
  const saved = await created.save(); // timestamps applied automatically
  return saved.toObject();
}

export function updateById(id: string | Types.ObjectId, update: any) {
  // Never set timestamps manually; let Mongoose handle it.
  if ("dateCreated" in update) delete update.dateCreated;
  if ("dateLastUpdated" in update) delete update.dateLastUpdated;

  return ActModel.findByIdAndUpdate(id as any, update, {
    new: true,
    runValidators: true,
    timestamps: true, // ensure updatedAt bump on FOU paths
  }).lean();
}

/**
 * Delete semantics:
 * 1) Try findByIdAndDelete first (returns removed doc if found)
 * 2) If null, fall back to deleteOne({_id}) and consider success when deletedCount > 0
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
