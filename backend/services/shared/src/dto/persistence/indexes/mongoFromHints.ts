// backend/services/shared/src/dto/persistence/indexes/mongoFromHints.ts
/**
 * Purpose:
 * - Translate DB-agnostic IndexHint[] → Mongo index specs.
 * - Keep Mongo specifics out of DTOs and callers.
 * - IMPORTANT: omit optional flags unless they’re explicitly boolean/defined.
 */

import type { IndexHint } from "../../../../../packages/dto/core/index-hints";

export type MongoIndexSpec = {
  keys: Record<string, 1 | -1 | "text" | "hashed">;
  options?: {
    name?: string;
    unique?: boolean;
    expireAfterSeconds?: number;
    sparse?: boolean;
  };
};

function withOpt<T extends object>(base: T, add: Record<string, unknown>): T {
  const out: any = { ...base };
  for (const [k, v] of Object.entries(add)) {
    if (v === undefined || v === null) continue; // drop undefined/null
    if (k === "sparse" && typeof v !== "boolean") continue; // drop non-boolean sparse
    out[k] = v;
  }
  return out as T;
}

export function mongoFromHints(
  entity: string,
  hints: IndexHint[]
): MongoIndexSpec[] {
  const specs: MongoIndexSpec[] = [];

  for (const h of hints) {
    switch (h.kind) {
      case "lookup": {
        const keys = Object.fromEntries(
          h.fields.map((f: string) => [f, 1])
        ) as Record<string, 1>;
        const options = withOpt(
          { name: h.options?.name ?? `${entity}_${h.fields.join("_")}_idx` },
          { sparse: h.options?.sparse }
        );
        specs.push({ keys, options });
        break;
      }
      case "unique": {
        const keys = Object.fromEntries(
          h.fields.map((f: string) => [f, 1])
        ) as Record<string, 1>;
        const options = withOpt(
          {
            name: h.options?.name ?? `${entity}_${h.fields.join("_")}_uniq`,
            unique: true,
          },
          { sparse: h.options?.sparse }
        );
        specs.push({ keys, options });
        break;
      }
      case "text": {
        const keys = Object.fromEntries(
          h.fields.map((f: string) => [f, "text"])
        ) as Record<string, "text">;
        const options = withOpt(
          { name: h.options?.name ?? `${entity}_text_${h.fields.join("_")}` },
          {}
        );
        specs.push({ keys, options });
        break;
      }
      case "ttl": {
        const keys = { [h.field]: 1 } as Record<string, 1>;
        const options = withOpt(
          {
            name: h.options?.name ?? `${entity}_ttl_${h.field}`,
            expireAfterSeconds: h.seconds,
          },
          {}
        );
        specs.push({ keys, options });
        break;
      }
      case "hash": {
        const keys = Object.fromEntries(
          h.fields.map((f: string) => [f, "hashed"])
        ) as Record<string, "hashed">;
        const options = withOpt(
          { name: h.options?.name ?? `${entity}_hash_${h.fields.join("_")}` },
          { sparse: h.options?.sparse }
        );
        specs.push({ keys, options });
        break;
      }
      default:
        // ignore unknown kinds (forward-compatible)
        break;
    }
  }

  return specs;
}
