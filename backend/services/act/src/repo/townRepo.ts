// backend/services/act/src/repo/townRepo.ts
import Town from "../models/Town";

export function find(
  filter: Record<string, any>,
  projection: Record<string, 0 | 1> = {},
  sort: Record<string, 1 | -1> = { name: 1 },
  limit = 50
) {
  return Town.find(filter, projection).sort(sort).limit(limit).lean();
}

export function findById(
  id: string,
  projection: Record<string, 0 | 1> = { name: 1, state: 1, lat: 1, lng: 1 }
) {
  return Town.findById(id, projection).lean();
}
