// backend/services/shared/src/db/orderSpec.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *
 * Purpose:
 * - Define a deterministic DB order spec with mandatory `_id` tie-breaker.
 * - Provide helpers to normalize/validate and to emit driver-friendly sort objects.
 *
 * Invariants:
 * - `_id` is always present as the final field.
 * - Only explicit fields are allowed; no env defaults; no guessing.
 */

export type OrderDir = 1 | -1;

export type OrderTerm = {
  field: string; // dot-path allowed (e.g., "meta.startAt")
  dir: OrderDir; // 1 ASC, -1 DESC
};

export type OrderSpec = ReadonlyArray<OrderTerm>;

/**
 * Create a normalized OrderSpec ensuring `_id` is present as last term.
 * - Duplicates are removed (last one wins before `_id` is appended).
 * - Empty/undefined → returns just [{ _id: 1 }] unless a primary list is provided.
 */
export function buildOrderSpec(
  primary?: ReadonlyArray<OrderTerm> | null,
  fallbackIdDir: OrderDir = 1
): OrderSpec {
  const base = Array.isArray(primary) ? [...primary] : [];
  const seen = new Set<string>();
  const out: OrderTerm[] = [];

  for (const t of base) {
    if (!t || typeof t.field !== "string" || !t.field.trim()) continue;
    const field = t.field.trim();
    const dir = t.dir === -1 ? -1 : 1;
    // keep last occurrence: drop earlier duplicate if seen
    if (seen.has(field)) {
      // remove previous term with same field
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].field === field) {
          out.splice(i, 1);
          break;
        }
      }
    }
    out.push({ field, dir });
    seen.add(field);
  }

  if (!seen.has("_id")) {
    out.push({ field: "_id", dir: fallbackIdDir });
  }
  return out;
}

/**
 * Validate that an OrderSpec is stable (i.e., contains `_id` last).
 * Throws with ops guidance if invalid.
 */
export function assertStableOrder(spec: OrderSpec): void {
  if (!spec.length) {
    throw new Error(
      "ORDER_SPEC_EMPTY: No order terms provided. Ops: set a primary order and include _id as the final tie-breaker."
    );
  }
  const last = spec[spec.length - 1];
  if (last.field !== "_id") {
    throw new Error(
      "ORDER_SPEC_UNSTABLE: _id must be the final term. Ops: append {_id:1} or {_id:-1} as the last order term."
    );
  }
}

/**
 * Convert an OrderSpec to a Mongo-style sort object.
 * Example: [{field:'h3',dir:1},{field:'startAt',dir:1},{field:'_id',dir:1}]
 *       →  { h3:1, startAt:1, _id:1 }
 */
export function toMongoSort(spec: OrderSpec): Record<string, 1 | -1> {
  assertStableOrder(spec);
  const sort: Record<string, 1 | -1> = {};
  for (const t of spec) sort[t.field] = t.dir === -1 ? -1 : 1;
  return sort;
}

/**
 * Handy presets for CRUD templates (keep boring, predictable defaults).
 * Adjust per-service when real world fields exist.
 */
export const ORDER_STABLE_ID_ASC: OrderSpec = buildOrderSpec([
  { field: "_id", dir: 1 },
]);
export const ORDER_STABLE_ID_DESC: OrderSpec = buildOrderSpec([
  { field: "_id", dir: -1 },
]);

/**
 * Example helper to combine a primary composite order with `_id` tie-breaker.
 * Use in services once you decide your real primary fields.
 */
export function composePrimaryOrder(
  fields: ReadonlyArray<{ field: string; dir: OrderDir }>
): OrderSpec {
  return buildOrderSpec(fields);
}
