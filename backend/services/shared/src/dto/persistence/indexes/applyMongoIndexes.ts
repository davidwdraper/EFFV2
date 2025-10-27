// backend/services/shared/src/dto/persistence/indexes/applyMongoIndexes.ts
/**
 * Docs:
 * - ADR-0040/0041 (DTO-only persistence)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Apply Mongo index specs idempotently.
 * - If the target collection does not exist yet (common at boot), create it first.
 *
 * Behavior:
 * - Preflights collection existence via listCollections({ name }).
 * - Creates the collection if missing.
 * - Calls collection.createIndex(keys, options) for each spec.
 * - Does not throw on per-index errors unless absolutely necessary; let caller decide.
 */

import type { MongoIndexSpec } from "./mongoFromHints";

type AnyCollection = {
  collectionName?: string;
  createIndex: (
    keys: Record<string, any>,
    options?: Record<string, any>
  ) => Promise<string>;
  db?: {
    listCollections: (
      filter: Record<string, any>,
      opts?: Record<string, any>
    ) => {
      toArray: () => Promise<Array<{ name: string }>>;
    };
    createCollection: (name: string) => Promise<any>;
  };
};

export async function applyMongoIndexes(
  collection: AnyCollection,
  specs: MongoIndexSpec[],
  opts?: {
    collectionName?: string;
    log?: {
      info?: Function;
      warn?: Function;
      error?: Function;
      debug?: Function;
    };
  }
): Promise<void> {
  const log = opts?.log;
  const collName =
    opts?.collectionName ??
    (collection as any).collectionName ??
    "unknown_collection";

  // Preflight: ensure collection exists (avoid "ns does not exist")
  const db = (collection as any).db;
  if (db && typeof db.listCollections === "function") {
    try {
      const existing = await db
        .listCollections({ name: collName }, { nameOnly: true })
        .toArray();
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.createCollection(collName);
        log?.info?.(
          { event: "collection_created", collection: collName },
          "Mongo collection created"
        );
      }
    } catch (e) {
      // If we can't preflight, surface a clear message — indexes will almost certainly fail otherwise.
      const msg = (e as Error)?.message ?? String(e);
      throw new Error(`Failed preflight for collection "${collName}": ${msg}`);
    }
  }

  // Apply each index spec idempotently
  for (const spec of specs) {
    try {
      await collection.createIndex(spec.keys, spec.options);
      log?.debug?.(
        {
          event: "index_applied",
          collection: collName,
          keys: spec.keys,
          options: spec.options,
        },
        "Mongo index ensured"
      );
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      // Report but do not crash the service at boot; leave policy to caller.
      log?.error?.(
        {
          event: "index_apply_failed",
          collection: collName,
          keys: spec.keys,
          options: spec.options,
          error: msg,
        },
        "Failed to apply index"
      );
    }
  }
}
