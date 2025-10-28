// backend/services/shared/src/dto/persistence/adapters/mongo/mongoNormalizeId.ts
/**
 * Docs:
 * - SOP: DTO-only persistence (no leaked DB shapes)
 * - ADR-0040 (DTO-Only Persistence; WAL-first writes)
 *
 * Purpose:
 * - Convert Mongo-native shapes to DTO-friendly JSON before hydration.
 * - Currently: coerce _id: ObjectId -> string (hex).
 *
 * Notes:
 * - Keep this adapter tiny & pure. No logging here.
 */

import type { ObjectId } from "mongodb";

type WithId = { _id?: unknown; [k: string]: unknown };

export function mongoNormalizeId<T extends WithId>(raw: T): T {
  const v = raw?._id as unknown;
  // Lazy import signature: avoid hard dep at type level
  const isObjId =
    v &&
    typeof v === "object" &&
    // duck-type for ObjectId
    typeof (v as any).toHexString === "function";
  if (!isObjId) return raw;

  const hex = (v as any).toHexString();
  return { ...raw, _id: hex } as T;
}
