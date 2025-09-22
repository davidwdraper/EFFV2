// backend/services/act/src/models/Act.allowed.ts
import Act from "./Act";

/**
 * Canonical client-writable keys derived from the Mongoose schema.
 * Keeps controller logic free of hardcoded field lists and prevents drift.
 */
const FORBIDDEN = new Set<string>([
  "_id",
  "__v",
  "dateCreated",
  "dateLastUpdated",
]);

// Collect unique root keys from schema paths (left side of the first ".")
const rootKeys = new Set<string>();
Object.keys(Act.schema.paths).forEach((p) => {
  const root = p.split(".")[0];
  if (!FORBIDDEN.has(root)) rootKeys.add(root);
});

/** Frozen list so no one mutates at runtime. */
export const ACT_INSERT_KEYS = Object.freeze(Array.from(rootKeys));

/** Shallow pick of allowed create fields. */
export function pickActInsert(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ACT_INSERT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      out[k] = (data as any)[k];
    }
  }
  return out;
}
