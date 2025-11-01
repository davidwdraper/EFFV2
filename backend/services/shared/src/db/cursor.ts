// backend/services/shared/src/db/cursor.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *
 * Purpose:
 * - Provide a deterministic, opaque paging cursor for keyset pagination.
 * - Encode/decode { order, last, rev } as base64 JSON.
 * - Build a DB "seek" filter that continues AFTER (or BEFORE when rev=true) the last keyset.
 *
 * Invariants:
 * - `order` must be a stable OrderSpec with `_id` as final tie-breaker.
 * - `last` must include exactly the fields in `order` (same names, same arity).
 * - No env defaults; no guessing. All inputs explicit.
 *
 * Notes:
 * - This module is DB-agnostic but emits a Mongo-friendly seek filter shape.
 * - Consumers (DbReader) apply .sort(order) and limit(N) separately.
 */

import type { OrderSpec, OrderDir } from "./orderSpec";
import { assertStableOrder } from "./orderSpec";

/** The keyset captured for the last returned item of a page. */
export type Keyset = Record<string, unknown>;

export type CursorPayload = Readonly<{
  order: OrderSpec;
  last: Keyset;
  /** If true, the seek is reversed (for prev-page style reads). Optional. */
  rev?: boolean;
}>;

/** Opaque base64-JSON cursor */
export function encodeCursor(payload: CursorPayload): string {
  assertStableOrder(payload.order);
  validateKeyset(payload.order, payload.last);
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  if (!cursor || typeof cursor !== "string") {
    throw new Error(
      "CURSOR_DECODE_EMPTY: Cursor string is empty. Ops: client should pass the `nextCursor` exactly as received."
    );
  }
  let obj: unknown;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    obj = JSON.parse(json);
  } catch {
    throw new Error(
      "CURSOR_DECODE_INVALID: Cursor is not valid base64-JSON. Ops: verify client is not double-encoding/decoding."
    );
  }
  const payload = obj as CursorPayload;
  assertStableOrder(payload.order);
  validateKeyset(payload.order, payload.last);
  return payload;
}

/** Build a keyset from a document (DTO JSON or plain object) according to the order spec. */
export function keysetFromDoc(
  doc: Record<string, unknown>,
  order: OrderSpec
): Keyset {
  assertStableOrder(order);
  const ks: Keyset = {};
  for (const t of order) {
    ks[t.field] = readPath(doc, t.field);
  }
  validateKeyset(order, ks);
  return ks;
}

/**
 * Compare two keysets by the provided order.
 * Returns: -1 if a<b, 0 if equal, 1 if a>b.
 */
export function compareKeysets(a: Keyset, b: Keyset, order: OrderSpec): number {
  assertStableOrder(order);
  for (const t of order) {
    const av = a[t.field];
    const bv = b[t.field];
    const dir = t.dir === -1 ? -1 : 1;
    const c = basicCompare(av, bv);
    if (c !== 0) return dir * c;
  }
  return 0;
}

/**
 * Build a Mongo-style seek filter that selects rows strictly AFTER the given keyset.
 * For composite order [f1, f2, ..., _id], this expands to:
 *   { $or: [
 *       { f1: gt1 },
 *       { f1: eq1, f2: gt2 },
 *       ...
 *       { f1: eq1, f2: eq2, ..., _id: gtN }
 *   ] }
 * Where gti is $gt or $lt depending on sort dir (and rev flag).
 *
 * Use:
 *   const seek = toMongoSeekFilter(order, last, rev);
 *   collection.find({ ...filter, ...seek }).sort(toMongoSort(order)).limit(N)
 *
 * Implementation note:
 * - Do NOT normalize values here. Pass raw keyset values through.
 *   DbReader will run the final filter through `coerceForMongoQuery(...)`,
 *   which converts `_id` payloads (e.g., {$oid:"…"} or 24-hex) into ObjectId.
 */
export function toMongoSeekFilter(
  order: OrderSpec,
  last: Keyset,
  rev = false
): Record<string, unknown> {
  assertStableOrder(order);
  validateKeyset(order, last);

  const ors: Record<string, unknown>[] = [];
  for (let i = 0; i < order.length; i++) {
    const ands: Record<string, unknown> = {};
    // Equalities for all prior terms
    for (let j = 0; j < i; j++) {
      const f = order[j].field;
      ands[f] = last[f];
    }
    // Strict inequality for the i-th term
    const term = order[i];
    const dir: OrderDir = term.dir === -1 ? -1 : 1;

    // If rev=true, flip the sense (seeking "previous" page)
    const op = (rev ? dir : 1) === 1 ? "$gt" : "$lt";
    ands[term.field] = { [op]: last[term.field] };

    ors.push(ands);
  }
  return { $or: ors };
}

/* ----------------- helpers ----------------- */

function validateKeyset(order: OrderSpec, ks: Keyset): void {
  const missing: string[] = [];
  for (const t of order) {
    if (!(t.field in ks)) missing.push(t.field);
  }
  if (missing.length) {
    throw new Error(
      `CURSOR_KEYSET_INCOMPLETE: Missing fields [${missing.join(
        ", "
      )}] in keyset. Ops: ensure last item was serialized with all ordered fields.`
    );
  }
}

/** Read simple dot-paths (e.g., "meta.startAt"). */
function readPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Normalize values so comparison works for common scalar types. */
function normalizeComparable(
  v: unknown
): string | number | boolean | null | Date {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const t = typeof v;
  if (t === "number" || t === "boolean") return v as number | boolean;
  if (t === "string") return v as string;
  // Fallback: JSON-stable-ish string (used in compareKeysets only)
  return JSON.stringify(v);
}

/** Basic tri-state compare for normalized scalars. */
function basicCompare(a: unknown, b: unknown): -1 | 0 | 1 {
  const av = normalizeComparable(a) as any;
  const bv = normalizeComparable(b) as any;

  if (av === bv) return 0;
  if (av instanceof Date && bv instanceof Date) {
    const at = av.getTime();
    const bt = bv.getTime();
    return at < bt ? -1 : 1;
  }
  return av < bv ? -1 : 1;
}
