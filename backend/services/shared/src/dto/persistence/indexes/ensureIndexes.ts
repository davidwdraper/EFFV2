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
 * Important policy (name vs structure):
 * - Index NAME mismatches are NOT errors.
 * - Index STRUCTURE mismatches ARE errors (fail-fast).
 * - Therefore: we do NOT pass "name" into createIndexes().
 *   Names from hints are informational (logging only).
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

type DesiredIndexModel = {
  key: Record<string, any>;
  unique?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: any;
  collation?: any;
  sparse?: boolean;
  weights?: any; // text index
  default_language?: string;
  language_override?: string;

  // informational only (NOT passed to mongo)
  _expectedName?: string;
};

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
    "ensureIndexes: begin deterministic index ensure (structure enforced; names ignored)"
  );

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    for (const [collection, dtoCtors] of grouped.entries()) {
      const col = db.collection(collection);

      const allHints = dtoCtors.flatMap((d) => d.indexHints);
      const desired = buildDesiredIndexModels(allHints, log);

      if (desired.length === 0) {
        log.info(
          { collection },
          "ensureIndexes: no indexHints found — skipping"
        );
        continue;
      }

      // Read existing index specs so we can treat "same structure, different name"
      // as satisfied, and "same key, different structure" as fail-fast.
      //
      // IMPORTANT:
      // - listIndexes throws NamespaceNotFound if the collection does not exist yet.
      // - A missing collection at boot is NOT an error; treat it as "no existing indexes".
      const existing = await safeListIndexes(col, collection, log);

      // Ensure each desired index exists by STRUCTURE (ignore name).
      const toCreate = computeMissingIndexes({
        collection,
        desired,
        existing,
        log,
      });

      if (toCreate.length === 0) {
        log.info(
          { collection, desiredCount: desired.length },
          "ensureIndexes: all indexes already satisfied (structure match)"
        );
        continue;
      }

      // IMPORTANT: do NOT pass names to Mongo.
      // If an existing index has same structure but different name, Mongo would throw.
      // We pre-filter those out above.
      const createModels = toCreate.map((m) => stripInternal(m));

      const result = await col.createIndexes(createModels);
      log.info(
        {
          collection,
          created: result,
          createdCount: createModels.length,
        },
        "ensureIndexes: indexes created successfully"
      );
    }
  } finally {
    await client.close();
  }
}

/**
 * listIndexes() helper:
 * - If the collection does not exist yet, Mongo can throw NamespaceNotFound ("ns does not exist").
 * - That is normal at boot for brand-new deployments.
 * - Treat as: existing indexes = [] and proceed to createIndexes().
 */
async function safeListIndexes(
  col: any,
  collection: string,
  log: ILogger
): Promise<any[]> {
  try {
    return await col.indexes();
  } catch (err: any) {
    const code = err?.code;
    const msg = String(err?.message ?? err);

    // Mongo NamespaceNotFound is commonly code 26, but do not depend on it exclusively.
    const isNsMissing =
      code === 26 ||
      /ns does not exist/i.test(msg) ||
      /NamespaceNotFound/i.test(msg);

    if (isNsMissing) {
      log.info(
        { collection, note: "collection_missing_treated_as_empty" },
        "ensureIndexes: collection does not exist yet — treating existing indexes as empty"
      );
      return [];
    }

    // Anything else is a real failure (connectivity/auth/etc.).
    log.error(
      { collection, err: msg, code: code ?? null },
      "ensureIndexes: failed to list existing indexes"
    );
    throw err;
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

function stripInternal(m: DesiredIndexModel): any {
  const { _expectedName, ...rest } = m;
  return rest;
}

function computeMissingIndexes(opts: {
  collection: string;
  desired: DesiredIndexModel[];
  existing: any[];
  log: ILogger;
}): DesiredIndexModel[] {
  const { collection, desired, existing, log } = opts;

  const existingNorm = (existing ?? []).map((ix) => ({
    name: String(ix?.name ?? ""),
    norm: normalizeIndexSpec(ix),
    raw: ix,
  }));

  const toCreate: DesiredIndexModel[] = [];

  for (const want of desired) {
    const wantNorm = normalizeIndexSpec(want);

    // 1) If any existing index matches the desired STRUCTURE, we’re satisfied.
    const match = existingNorm.find((e) => deepEqual(e.norm, wantNorm));
    if (match) {
      if (
        want._expectedName &&
        match.name &&
        match.name !== want._expectedName
      ) {
        log.info(
          {
            collection,
            expectedName: want._expectedName,
            existingName: match.name,
            key: want.key,
          },
          "ensureIndexes: index structure already exists with a different name (name ignored)"
        );
      }
      continue;
    }

    // 2) If an index exists with the same key pattern but conflicting options, fail-fast.
    const wantKeySig = keySignature(want.key);
    const keyConflicts = existingNorm.filter(
      (e) => keySignature(e.raw?.key) === wantKeySig
    );

    if (keyConflicts.length > 0) {
      const conflictNames = keyConflicts.map((c) => c.name).filter(Boolean);
      log.error(
        {
          collection,
          desiredKey: want.key,
          expectedName: want._expectedName ?? null,
          existingIndexes: keyConflicts.map((c) => ({
            name: c.name,
            key: c.raw?.key,
            unique: !!c.raw?.unique,
            expireAfterSeconds: c.raw?.expireAfterSeconds,
            partialFilterExpression: c.raw?.partialFilterExpression,
            collation: c.raw?.collation,
            sparse: c.raw?.sparse,
            weights: c.raw?.weights,
          })),
        },
        "ensureIndexes: index key exists but structure differs (conflict) — aborting"
      );

      throw new Error(
        `ENSURE_INDEXES_CONFLICT: collection="${collection}" has an existing index with the same key pattern but different structure. ` +
          `Desired key=${wantKeySig}. Existing index names=${JSON.stringify(
            conflictNames
          )}. ` +
          "Ops/Dev: drop/rename the conflicting index (or update DTO indexHints) so structure matches exactly."
      );
    }

    // 3) Otherwise, we need to create it.
    toCreate.push(want);
  }

  return toCreate;
}

/**
 * Build desired Mongo index models from IndexHint union.
 *
 * IMPORTANT:
 * - We intentionally ignore/strip the "name" option.
 * - If name is provided, we keep it only for logging as _expectedName.
 */
function buildDesiredIndexModels(
  hints: ReadonlyArray<IndexHint>,
  log: ILogger
): DesiredIndexModel[] {
  return hints.map((h) => {
    switch (h.kind) {
      case "lookup": {
        const key = Object.fromEntries(h.fields.map((f) => [f, 1]));
        const expectedName = (h.options as any)?.name;
        const { name: _ignored, ...rest } = (h.options ?? {}) as any;
        return {
          key,
          ...rest,
          unique: false as const,
          _expectedName: expectedName,
        };
      }
      case "unique": {
        const key = Object.fromEntries(h.fields.map((f) => [f, 1]));
        const expectedName = (h.options as any)?.name;
        const { name: _ignored, ...rest } = (h.options ?? {}) as any;
        return {
          key,
          ...rest,
          unique: true as const,
          _expectedName: expectedName,
        };
      }
      case "text": {
        const key = Object.fromEntries(
          h.fields.map((f) => [f, "text" as const])
        );
        const expectedName = (h.options as any)?.name;
        const { name: _ignored, ...rest } = (h.options ?? {}) as any;
        return {
          key,
          ...rest,
          unique: false as const,
          _expectedName: expectedName,
        };
      }
      case "ttl": {
        const expectedName = (h.options as any)?.name;
        const { name: _ignored, ...rest } = (h.options ?? {}) as any;
        return {
          key: { [h.field]: 1 },
          expireAfterSeconds: h.seconds,
          ...rest,
          unique: false as const,
          _expectedName: expectedName,
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
        const expectedName = (h.options as any)?.name;
        const { name: _ignored, ...rest } = (h.options ?? {}) as any;
        return {
          key: { [field]: "hashed" as const },
          ...rest,
          unique: false as const,
          _expectedName: expectedName,
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

/**
 * Normalize an index spec for STRUCTURE comparison.
 * We remove fields that should not matter:
 * - name
 * - ns
 * - v
 * and we compare the meaningful options.
 */
function normalizeIndexSpec(ix: any): any {
  const key = ix?.key ?? {};
  const norm: any = {
    key: normalizeKey(key),
    unique: ix?.unique === true ? true : false,
  };

  if (ix?.expireAfterSeconds !== undefined)
    norm.expireAfterSeconds = ix.expireAfterSeconds;

  if (ix?.partialFilterExpression !== undefined)
    norm.partialFilterExpression = ix.partialFilterExpression;

  if (ix?.collation !== undefined) norm.collation = ix.collation;

  if (ix?.sparse !== undefined) norm.sparse = ix.sparse === true;

  if (ix?.weights !== undefined) norm.weights = ix.weights;

  if (ix?.default_language !== undefined)
    norm.default_language = ix.default_language;

  if (ix?.language_override !== undefined)
    norm.language_override = ix.language_override;

  return norm;
}

function normalizeKey(key: any): any {
  const obj = (key ?? {}) as Record<string, any>;
  const entries = Object.entries(obj).map(([k, v]) => [k, v]);
  // preserve field order deterministically for comparison:
  return Object.fromEntries(entries);
}

function keySignature(key: any): string {
  const obj = normalizeKey(key ?? {});
  return JSON.stringify(obj);
}

function deepEqual(a: any, b: any): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(v: any): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v !== "object") return JSON.stringify(v);

  if (Array.isArray(v)) {
    return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  }

  const obj = v as Record<string, any>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`
  );
  return `{${parts.join(",")}}`;
}
