// backend/services/shared/src/dto/persistence/indexes/ensureIndexes.ts
/**
 * Docs:
 * - ADR-0040/41 (DTO-only persistence)
 * - ADR-0044 (Env DTO as Key/Value Contract)
 * - ADR-0045 (Index Hints — burn-after-read & boot ensure)
 * - ADR-0074 (DB_STATE + _infra database invariants)
 *
 * Purpose:
 * - Deterministically ensure Mongo indexes for a set of DTOs at service boot.
 * - No fallbacks: misconfiguration = startup failure (dev == prod).
 * - Collection names are resolved **by the DTO class** (dbCollectionName()),
 *   not passed in from the caller.
 *
 * Notes:
 * - Historically this used SvcEnvDto; the dependency is now a generic env
 *   contract exposing:
 *     • getEnvVar(name: string): string
 *     • getDbVar(name: string): string  (DB_STATE-aware)
 *   (e.g. DbEnvServiceDto).
 */

import type { IndexHint } from "../../persistence/index-hints";
import type { ILogger } from "../../../logger/Logger";
import { MongoClient } from "mongodb";

/**
 * Minimal contract for env DTOs used here.
 * Any DTO that can supply Mongo connection strings via getEnvVar/getDbVar
 * is acceptable (typically DbEnvServiceDto).
 */
export type SvcEnvConfig = {
  getEnvVar: (name: string) => string;
  getDbVar: (name: string) => string; // DB_STATE + _infra aware
};

/**
 * DTO class shape we require for index creation.
 * Expect a CLASS (not an instance) with:
 *  - static indexHints: ReadonlyArray<IndexHint>
 *  - static dbCollectionName(): string
 *  - optional .name for logging
 */
export type DtoCtorWithIndexes = {
  name?: string;
  indexHints: ReadonlyArray<IndexHint>;
  dbCollectionName: () => string;
};

export interface EnsureIndexesOptions {
  /** Array of DTO CLASSES that declare indexHints and can resolve their collection */
  dtos: DtoCtorWithIndexes[];
  /**
   * Env config carrier (typically DbEnvServiceDto) that can supply:
   *  - NV_MONGO_URI via getDbVar()   (DB_STATE-aware)
   *  - NV_MONGO_DB  via getDbVar()   (DB_STATE-aware)
   */
  env: SvcEnvConfig;
  log: ILogger;
}

export async function ensureIndexesForDtos(
  opts: EnsureIndexesOptions
): Promise<void> {
  const { dtos, env, log } = opts;

  let uri: string;
  let dbName: string;
  try {
    // ADR-0074: both URI and DB name are DB_STATE-aware and must be read via getDbVar()
    uri = env.getDbVar("NV_MONGO_URI");
    dbName = env.getDbVar("NV_MONGO_DB");
  } catch (e) {
    const msg =
      (e as Error)?.message ??
      "Missing required Mongo env vars NV_MONGO_URI/NV_MONGO_DB.";
    log.error(
      { err: msg },
      "ensureIndexes: failed to read NV_MONGO_URI/NV_MONGO_DB from svc env config"
    );
    throw new Error(
      `${msg} Ops: ensure env-service configuration document for this service includes NV_MONGO_URI and NV_MONGO_DB as non-empty strings.`
    );
  }

  if (!uri || !dbName) {
    log.error(
      { uri_present: !!uri, db_present: !!dbName },
      "ensureIndexes: missing required env configuration"
    );
    throw new Error(
      "ensureIndexes: required env values missing — aborting startup. " +
        "Ops: verify NV_MONGO_URI and NV_MONGO_DB in env-service for this service/version."
    );
  }

  if (!Array.isArray(dtos) || dtos.length === 0) {
    log.info("ensureIndexes: no DTOs provided — nothing to do");
    return;
  }

  // Group DTOs by their resolved collection name.
  // This avoids redundant createIndexes() calls for the same collection.
  const grouped = new Map<string, DtoCtorWithIndexes[]>();

  for (const dto of dtos) {
    // This will throw loudly if dbCollectionName() is miswired or empty —
    // desired fail-fast behavior.
    const collection = safeResolveCollection(dto, log);
    const arr = grouped.get(collection) ?? [];
    arr.push(dto);
    grouped.set(collection, arr);
  }

  log.info(
    {
      db: dbName,
      collections: Array.from(grouped.keys()),
      dtos: dtos.map((d) => d.name ?? "<anon>"),
    },
    "ensureIndexes: begin deterministic index creation"
  );

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    for (const [collection, dtoCtors] of grouped.entries()) {
      const col = db.collection(collection);
      const allHints = dtoCtors.flatMap((d) => d.indexHints);
      const indexModels = buildIndexModels(allHints, log);

      if (indexModels.length === 0) {
        log.info(
          { collection },
          "ensureIndexes: no indexHints found — skipping"
        );
        continue;
      }

      // NOTE: no commitQuorum — valid on both standalone and replica set.
      const result = await col.createIndexes(indexModels);
      log.info(
        { collection, created: result },
        "ensureIndexes: indexes created successfully"
      );
    }
  } finally {
    await client.close();
  }
}

/** Resolve the collection name for a DTO class and log helpful context on failure. */
function safeResolveCollection(dto: DtoCtorWithIndexes, log: ILogger): string {
  try {
    const name = dto.dbCollectionName();
    if (!name || !name.trim()) {
      throw new Error("empty collection name");
    }
    return name;
  } catch (err: any) {
    log.error(
      { dto: dto.name ?? "<anon>", err: String(err?.message ?? err) },
      "ensureIndexes: failed to resolve dbCollectionName() from DTO"
    );
    throw new Error(
      `ensureIndexes: DTO ${
        dto.name ?? "<anon>"
      } cannot resolve db collection. ` +
        "Ops: verify the DTO implements a static dbCollectionName() that returns a non-empty string."
    );
  }
}

/**
 * Map IndexHint union to Mongo index models.
 */
function buildIndexModels(hints: ReadonlyArray<IndexHint>, log: ILogger) {
  return hints.map((h) => {
    switch (h.kind) {
      case "lookup": {
        const key = Object.fromEntries(h.fields.map((f) => [f, 1]));
        return { key, ...(h.options ?? {}), unique: false as const };
      }
      case "unique": {
        const key = Object.fromEntries(h.fields.map((f) => [f, 1]));
        return { key, ...(h.options ?? {}), unique: true as const };
      }
      case "text": {
        const key = Object.fromEntries(
          h.fields.map((f) => [f, "text" as const])
        );
        return { key, ...(h.options ?? {}), unique: false as const };
      }
      case "ttl": {
        return {
          key: { [h.field]: 1 },
          expireAfterSeconds: h.seconds,
          ...(h.options ?? {}),
          unique: false as const,
        };
      }
      case "hash": {
        if (h.fields.length !== 1) {
          log.error(
            { fields: h.fields },
            "ensureIndexes: hashed index must be single-field"
          );
          throw new Error("ensureIndexes: hashed index must be single-field");
        }
        const field = h.fields[0];
        return {
          key: { [field]: "hashed" as const },
          ...(h.options ?? {}),
          unique: false as const,
        };
      }
      default: {
        const _exhaustive: never = h as never;
        throw new Error(
          `ensureIndexes: unknown IndexHint kind ${(h as any)?.kind}`
        );
      }
    }
  });
}
