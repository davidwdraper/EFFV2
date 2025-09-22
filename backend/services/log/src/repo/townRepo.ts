// backend/services/act/src/repo/townRepo.ts
import TownModel, { TownDocument } from "../models/Town";

export async function find(
  filter: any,
  projection: any,
  sort: any,
  limit: number
) {
  return TownModel.find(filter, projection)
    .sort(sort)
    .limit(limit)
    .lean<TownDocument[]>();
}

export async function findById(id: string, projection?: any) {
  return TownModel.findById(id, projection).lean<TownDocument | null>();
}
