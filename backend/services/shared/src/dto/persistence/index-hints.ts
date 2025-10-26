// backend/services/shared/src/dto/persistence/index-hints.ts
/**
 * Purpose:
 * - DB-agnostic index hints + helpers to attach/read/consume them from a DTO class.
 * - No BaseDto edits required; safe to use with existing DTO classes.
 *
 * Usage in a DTO module:
 *   setIndexHints(XxxDto, [{ kind: "lookup", fields: ["txtfield1"] }]);
 *   // later at boot/handler:
 *   const hints = consumeIndexHints(XxxDto); // returns hints and clears them
 */

export type IndexHint =
  | { kind: "lookup"; fields: string[] } // equality / sort
  | { kind: "unique"; fields: string[] } // must be unique together
  | { kind: "text"; fields: string[] } // full-text search
  | { kind: "ttl"; field: string; seconds: number }; // expiry

type HintCarrier = { __indexHints__?: IndexHint[] };

export function setIndexHints(ctor: Function, hints: IndexHint[]): void {
  const anyCtor = ctor as unknown as HintCarrier;
  anyCtor.__indexHints__ = Array.isArray(hints) ? [...hints] : [];
}

export function getIndexHints<T = unknown>(ctor: Function): IndexHint[] {
  const anyCtor = ctor as unknown as HintCarrier;
  return anyCtor.__indexHints__ ? [...anyCtor.__indexHints__] : [];
}

/** Returns the current hints AND clears them from the class (one-shot). */
export function consumeIndexHints(ctor: Function): IndexHint[] {
  const anyCtor = ctor as unknown as HintCarrier;
  const out = anyCtor.__indexHints__ ? [...anyCtor.__indexHints__] : [];
  anyCtor.__indexHints__ = []; // delete deadwood
  return out;
}
