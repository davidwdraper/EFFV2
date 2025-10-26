// backend/services/shared/src/dto/persistence/indexes/mongoFromHints.ts
/**
 * Purpose:
 * - Translate DB-agnostic IndexHint[] → Mongo index specs.
 * - Keep Mongo specifics out of DTOs.
 */

import type { IndexHint } from "../index-hints";

export type MongoIndexSpec = {
  keys: Record<string, 1 | -1 | "text" | "hashed">;
  options?: {
    name?: string;
    unique?: boolean;
    expireAfterSeconds?: number;
    sparse?: boolean;
  };
};

export function mongoFromHints(
  entity: string,
  hints: IndexHint[]
): MongoIndexSpec[] {
  const specs: MongoIndexSpec[] = [];
  for (const h of hints) {
    if (h.kind === "lookup") {
      specs.push({
        keys: Object.fromEntries(h.fields.map((f) => [f, 1])),
        options: { name: `${entity}_${h.fields.join("_")}_idx` },
      });
    } else if (h.kind === "unique") {
      specs.push({
        keys: Object.fromEntries(h.fields.map((f) => [f, 1])),
        options: { name: `${entity}_${h.fields.join("_")}_uniq`, unique: true },
      });
    } else if (h.kind === "text") {
      specs.push({
        keys: Object.fromEntries(h.fields.map((f) => [f, "text"])),
        options: { name: `${entity}_text_${h.fields.join("_")}` },
      });
    } else if (h.kind === "ttl") {
      specs.push({
        keys: { [h.field]: 1 },
        options: {
          name: `${entity}_ttl_${h.field}`,
          expireAfterSeconds: h.seconds,
        },
      });
    }
  }
  return specs;
}
