// backend/services/shared/src/dto/persistence/adapters/mongo/queryHelper.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence boundary)
 * - ADR-0047 (DtoBag/batching — shared invariants)
 * - ADR-0048 (Reader/Writer contracts at the DB edge)
 *
 * Purpose:
 * - Single canonical place to coerce DTO-world query shapes into Mongo-native shapes.
 * - Today: convert `_id` string that looks like a 24-hex to `new ObjectId(...)`.
 * - Recursive: handles arrays, nested objects, and operator objects (e.g., {_id: {$gt: ...}}).
 *
 * Notes:
 * - Keep it tiny and deterministic. No logging. Pure function.
 */

import { ObjectId } from "mongodb";

export function coerceForMongoQuery(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(coerceForMongoQuery);
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "_id") {
        out[k] = coerceMongoIdValue(v);
      } else {
        out[k] = coerceForMongoQuery(v);
      }
    }
    return out;
  }
  return node;
}

// Accept single value or operator object for _id (e.g., {$gt: "..."}).
function coerceMongoIdValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const inner = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [op, iv] of Object.entries(inner)) {
      out[op] = toObjectIdIfHex(iv);
    }
    return out;
  }
  return toObjectIdIfHex(v);
}

function toObjectIdIfHex(v: unknown): unknown {
  if (typeof v === "string" && /^[a-f0-9]{24}$/i.test(v)) {
    try {
      return new ObjectId(v);
    } catch {
      return v; // If driver rejects, fall back safely.
    }
  }
  // Also accept {$oid: "..."} shapes if they show up.
  if (v && typeof v === "object" && "$oid" in (v as any)) {
    const s = String((v as any)["$oid"] ?? "");
    if (/^[a-f0-9]{24}$/i.test(s)) {
      try {
        return new ObjectId(s);
      } catch {
        return s;
      }
    }
    return s;
  }
  return v;
}
