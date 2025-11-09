// backend/services/shared/src/dto/persistence/adapters/mongo/mongoNormalizeToDto.ts
/**
 * Docs:
 * - SOP: DTO-only persistence (reads hydrate with validate=false)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts — canonical id field is "id")
 *
 * Purpose:
 * - Convert a raw Mongo document directly into a DTO-friendly shape:
 *   • Remove Mongo-only keys like `_id`, `__v`, etc.
 *   • Inject a canonical `id:string` (or overridable `idFieldName`) derived from `_id`.
 *   • Leave all other fields intact.
 *
 * Notes:
 * - This is the **only** step between raw Mongo and DTO instantiation.
 * - DbReader passes `idFieldName = "id"` for all DTOs.
 * - Cloners/templates MAY override idFieldName if they truly need a different name.
 */

export function mongoNormalizeToDto(raw: unknown, idFieldName = "id"): unknown {
  if (raw === null || typeof raw !== "object") return raw;

  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // --- Hardcoded blacklist of Mongo baggage NV never uses ---
  const disallowed = new Set([
    "_id", // replaced by idFieldName (canonical "id")
    "__v", // Mongoose-style version key (unused)
    "$clusterTime", // internal replication metadata
    "$db", // command metadata
    "$id", // BSON ref junk
    "$ref", // legacy DBRef junk
    "$timestamp", // internal diagnostic timestamp
  ]);

  // 1) Convert Mongo _id → idFieldName (canonical "id")
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
