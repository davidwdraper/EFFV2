/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *
 * Purpose:
 * - Apply Mongo index definitions idempotently at startup.
 * - Used by ControllerBase to ensure indexes from DTO IndexHints.
 *
 * Invariants:
 * - Never throws fatally on "already exists" errors.
 * - Logs or rethrows only unexpected driver errors.
 * - No writes or schema creation outside Mongo’s index subsystem.
 */

import type { Collection, CreateIndexesOptions } from "mongodb";

export type MongoIndexSpec = {
  keys: Record<string, 1 | -1 | "text" | "hashed">;
  options?: CreateIndexesOptions & { name?: string };
};

/**
 * Applies indexes idempotently.
 * @param collection - MongoDB Collection
 * @param specs - Array of index definitions
 * @param opts - Optional logging/metadata
 */
export async function applyMongoIndexes(
  collection: Collection,
  specs: MongoIndexSpec[],
  opts?: {
    collectionName?: string;
    log?: (msg: string, meta?: unknown) => void;
  }
): Promise<void> {
  const log = opts?.log ?? (() => {});
  const name = opts?.collectionName ?? collection.collectionName;

  if (!specs?.length) {
    log(`applyMongoIndexes: no index specs provided for ${name}`);
    return;
  }

  try {
    const existing = await collection.indexes();
    const existingNames = new Set(existing.map((e) => e.name));

    for (const spec of specs) {
      const { keys, options } = spec;
      const idxName =
        options?.name ?? `${Object.keys(keys).join("_")}_${name}_idx`;

      if (existingNames.has(idxName)) {
        log(`index exists: ${idxName} on ${name}`);
        continue;
      }

      try {
        await collection.createIndex(keys, { ...options, name: idxName });
        log(`index created: ${idxName} on ${name}`, { keys, options });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (/already exists/i.test(msg)) {
          log(`index already exists (race ok): ${idxName}`);
          continue;
        }
        log(`index creation failed: ${idxName}`, { error: msg });
        throw err;
      }
    }

    log(`index ensure complete for ${name}`);
  } catch (err) {
    log(`index ensure error for ${name}`, { error: (err as Error)?.message });
    throw err;
  }
}
