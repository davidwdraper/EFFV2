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
 * - Creates the collection if missing (best-effort; non-fatal if preflight fails).
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
  indexes?: () => Promise<
    Array<{ name: string; key: Record<string, unknown> }>
  >;
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
    collectionName?: string; // for logging only
    log?: {
      info?: Function;
      warn?: Function;
      error?: Function;
      debug?: Function;
    };
  }
): Promise<void> {
  const log = opts?.log;
  const actualName =
    (collection as any).collectionName ??
    opts?.collectionName ??
    "unknown_collection";
  const logName = opts?.collectionName ?? actualName;

  // Best-effort preflight: use the actual collection's name; don't abort on failure.
  const db = (collection as any).db;
  if (db && typeof db.listCollections === "function") {
    try {
      const existing = await db
        .listCollections({ name: actualName }, { nameOnly: true })
        .toArray();
      if (!Array.isArray(existing) || existing.length === 0) {
        await db.createCollection(actualName);
        log?.info?.(
          { event: "collection_created", collection: logName },
          "Mongo collection created"
        );
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      log?.warn?.(
        {
          event: "collection_preflight_failed",
          collection: logName,
          error: msg,
        },
        "Collection preflight failed (continuing; createIndex will autocreate)"
      );
    }
  }

  // Apply each index spec idempotently
  for (const spec of specs) {
    try {
      const res = await collection.createIndex(spec.keys, spec.options);
      log?.debug?.(
        {
          event: "index_applied",
          collection: logName,
          keys: spec.keys,
          options: spec.options,
          result: res,
        },
        "Mongo index ensured"
      );
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      log?.error?.(
        {
          event: "index_apply_failed",
          collection: logName,
          keys: spec.keys,
          options: spec.options,
          error: msg,
        },
        "Failed to apply index"
      );
    }
  }
}
