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
 */

export function mongoNormalizeToDto(raw: unknown, idFieldName = "id"): unknown {
  if (raw === null || typeof raw !== "object") return raw;

  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // --- Hardcoded blacklist of Mongo baggage NV never uses ---
  const disallowed = new Set([
    "_id", // replaced by idFieldName (canonical "id")
    "__v", // Mongoose-style version key (unused)
    "$clusterTime",
    "$db",
    "$id",
    "$ref",
    "$timestamp",
  ]);

  // 1) Convert Mongo _id → idFieldName (canonical "id")
  if (Object.prototype.hasOwnProperty.call(src, "_id")) {
    const v: any = (src as any)["_id"];

    let idStr = "";
    // True BSON ObjectId (works even if driver instances differ)
    if (v && typeof v === "object" && typeof v.toHexString === "function") {
      idStr = String(v.toHexString()).toLowerCase();
    } else if (typeof v === "string") {
      // Strip possible "ObjectId('...')" or 'ObjectId("...")' wrappers if leaked
      const m = v.match(/^ObjectId\(['"]?([0-9a-fA-F]{24})['"]?\)$/);
      idStr = (m ? m[1] : v).toLowerCase();
    } else {
      // As a last resort, avoid String(v) which can yield "ObjectId('...')"
      idStr = "";
    }

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
