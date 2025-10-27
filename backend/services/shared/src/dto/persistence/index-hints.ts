// backend/services/shared/src/dto/persistence/index-hints.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Burn-after-read consumption of static index hints on DTO classes.
 * - DTO declares; boot helper consumes; hints are deleted (no runtime baggage).
 */

export type LookupIndexHint = {
  kind: "lookup";
  fields: string[]; // simple ascending compound index
  options?: { name?: string; sparse?: boolean };
};

export type UniqueIndexHint = {
  kind: "unique";
  fields: string[]; // unique compound index
  options?: { name?: string; sparse?: boolean };
};

export type TextIndexHint = {
  kind: "text";
  fields: string[]; // text index over these fields
  options?: { name?: string };
};

export type TtlIndexHint = {
  kind: "ttl";
  field: string; // single datetime field
  seconds: number; // expireAfterSeconds
  options?: { name?: string };
};

export type HashIndexHint = {
  kind: "hash";
  fields: string[]; // hashed index (Mongo)
  options?: { name?: string; sparse?: boolean };
};

export type IndexHint =
  | LookupIndexHint
  | UniqueIndexHint
  | TextIndexHint
  | TtlIndexHint
  | HashIndexHint;

// Guards against double-consumption if the same DTO is passed twice.
const CONSUMED = new WeakSet<Function>();

export function consumeIndexHints(DtoCtor: Function): IndexHint[] {
  if (CONSUMED.has(DtoCtor)) return [];

  // Supported declaration styles on the DTO class:
  // 1) static indexHints: IndexHint[]
  // 2) static getIndexHints(): IndexHint[]
  const fromFunc = (DtoCtor as any)?.getIndexHints?.();
  const fromStatic = (DtoCtor as any)?.indexHints as IndexHint[] | undefined;

  const src: IndexHint[] = Array.isArray(fromFunc)
    ? fromFunc
    : Array.isArray(fromStatic)
    ? fromStatic
    : [];

  // Defensive copy so downstream mutations can’t touch the class
  const hints: IndexHint[] = src.map((h) =>
    h.kind === "ttl"
      ? {
          kind: "ttl",
          field: h.field,
          seconds: h.seconds,
          options: h.options ? { ...h.options } : undefined,
        }
      : {
          kind: h.kind,
          fields: [...(h as any).fields],
          options: (h as any).options ? { ...(h as any).options } : undefined,
        }
  );

  // Burn after read
  try {
    if ((DtoCtor as any).indexHints !== undefined)
      delete (DtoCtor as any).indexHints;
  } catch {}
  if (typeof (DtoCtor as any).getIndexHints === "function") {
    try {
      (DtoCtor as any).getIndexHints = () => [];
    } catch {}
  }

  CONSUMED.add(DtoCtor);
  return hints;
}
