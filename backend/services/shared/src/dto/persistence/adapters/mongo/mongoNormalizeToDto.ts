// backend/services/shared/src/dto/persistence/adapters/mongo/mongoNormalizeToDto.ts
/**
 * Docs:
 * - SOP: DTO-only persistence (reads hydrate with validate=false)
 * - ADRs: ADR-0040 (DTO-Only Persistence)
 *         ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *         ADR-0048 (DbReader/DbWriter contracts)
 *
 * Purpose:
 * - Convert a raw Mongo document directly into a DTO-friendly shape:
 *   • Remove Mongo-only keys like `_id`, `__v`, etc.
 *   • Inject `xxxId:string` (template literal for cloners).
 *   • Leave all other fields intact.
 *
 * Notes:
 * - Keeps literal template name `xxxId`.
 * - Shallow clone avoids mutating driver-owned cursor buffers.
 * - This is the **only** step between raw Mongo and DTO instantiation.
 */

export function mongoNormalizeToDto(
  raw: unknown,
  idFieldName = "xxxId"
): unknown {
  if (raw === null || typeof raw !== "object") return raw;

  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // --- Hardcoded blacklist of Mongo baggage NV never uses ---
  const disallowed = new Set([
    "_id", // replaced by xxxId
    "__v", // Mongoose-style version key (unused)
    "$clusterTime", // internal replication metadata
    "$db", // command metadata
    "$id", // BSON ref junk
    "$ref", // legacy DBRef junk
    "$timestamp", // internal diagnostic timestamp
  ]);

  // 1) Convert Mongo _id → xxxId
  if (Object.prototype.hasOwnProperty.call(src, "_id")) {
    const v = (src as any)["_id"];
    const idStr = typeof v === "string" ? v : v != null ? String(v) : "";
    out[idFieldName] = idStr;
  }

  // 2) Copy remaining fields, skipping blacklisted keys and duplicate id field
  for (const k of Object.keys(src)) {
    if (disallowed.has(k)) continue;
    if (k === idFieldName) continue; // don’t overwrite injected id
    out[k] = src[k];
  }

  return out;
}
