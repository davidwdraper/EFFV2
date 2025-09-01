// backend/services/user/src/repo/directoryRepo.ts
import Directory from "../models/user.directory.model";

export function find(
  filter: Record<string, any>,
  limit: number,
  offset: number
) {
  return Directory.find(filter).skip(offset).limit(limit).lean();
}

export function count(filter: Record<string, any>) {
  return Directory.countDocuments(filter);
}
