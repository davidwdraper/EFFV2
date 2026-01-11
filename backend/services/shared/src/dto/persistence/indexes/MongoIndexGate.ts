// backend/services/shared/src/dto/persistence/indexes/MongoIndexGate.ts
/**
 * Docs:
 * - ADR-0106 (Lazy index ensure via persistence IndexGate + IndexCheckCache)
 *
 * Purpose:
 * - Concrete MongoDB-backed index gate.
 * - Ensures declared DTO indexHints exist on the DTO's dbCollectionName().
 *
 * Design:
 * - Uses IndexCheckCache so each collection is ensured once per process.
 * - Accepts mongoUri/mongoDb directly to support env-service bootstrap shim.
 *
 * Supported hint shape (current NV DTOs):
 * - { kind: "unique"|"lookup", fields: string[], options?: { name?: string, ... } }
 *
 * IMPORTANT (real-world Mongo behavior):
 * - Mongo considers an index "the same" if the key spec + uniqueness match.
 * - Name is NOT part of index identity for conflict resolution.
 * - Therefore, if an equivalent index exists with a different name (e.g., env_1),
 *   we treat it as satisfied and DO NOT attempt to create another index with a new name.
 */

import { MongoClient } from "mongodb";
import type { IBoundLogger } from "../../../logger/Logger";
import type { DtoCtorWithIndexes, IIndexGate } from "./IndexGate";
import { IndexCheckCache } from "./IndexCheckCache";

type MongoIndexHint = {
  kind: "unique" | "lookup";
  fields: string[];
  options?: Record<string, unknown>;
};

type MongoIndexModel = {
  key: Record<string, 1>;
  name?: string;
  unique?: boolean; // IMPORTANT: must be absent unless true
};

type ExistingIndexInfo = {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
};

export class MongoIndexGate implements IIndexGate {
  private readonly cache: IndexCheckCache;

  public constructor(
    private readonly params: {
      mongoUri: string;
      mongoDb: string;
      log?: IBoundLogger;
      cache?: IndexCheckCache;
    }
  ) {
    const { mongoUri, mongoDb } = params;

    if (!mongoUri || !mongoUri.trim()) {
      throw new Error(
        "MONGO_INDEXGATE_INVALID: mongoUri is required. Ops: set NV_MONGO_URI."
      );
    }
    if (!mongoDb || !mongoDb.trim()) {
      throw new Error(
        "MONGO_INDEXGATE_INVALID: mongoDb is required. Ops: set NV_MONGO_DB."
      );
    }

    this.cache = params.cache ?? new IndexCheckCache();
  }

  public async ensureForDtoCtor(dtoCtor: DtoCtorWithIndexes): Promise<void> {
    const name = (dtoCtor as any)?.name ?? "unknown";
    const collectionName = dtoCtor?.dbCollectionName?.();

    if (!collectionName || !String(collectionName).trim()) {
      throw new Error(
        `MONGO_INDEXGATE_DTO_INVALID: dtoCtor.dbCollectionName() is missing/empty (dto=${name}).`
      );
    }

    const hints = dtoCtor?.indexHints;
    if (!Array.isArray(hints)) {
      throw new Error(
        `MONGO_INDEXGATE_DTO_INVALID: dtoCtor.indexHints[] is missing (dto=${name}, collection=${collectionName}).`
      );
    }

    const key = `${this.params.mongoUri}@@${this.params.mongoDb}@@${collectionName}`;

    await this.cache.ensureOnce(key, async () => {
      const log = this.params.log;

      log?.info?.(
        {
          event: "db_index_ensure_start",
          mongoDb: this.params.mongoDb,
          collectionName,
          dto: name,
          hintCount: hints.length,
        },
        "IndexGate ensure starting"
      );

      const client = new MongoClient(this.params.mongoUri);
      try {
        await client.connect();

        const db = client.db(this.params.mongoDb);
        const col = db.collection(collectionName);

        const desired = this.hintsToIndexModels(
          hints as ReadonlyArray<unknown>
        );

        if (desired.length === 0) {
          log?.info?.(
            {
              event: "db_index_ensure_skipped",
              mongoDb: this.params.mongoDb,
              collectionName,
              dto: name,
              reason: "no_supported_index_hints",
            },
            "IndexGate ensure skipped"
          );
          return;
        }

        // Fetch existing index inventory once.
        const existing = (await col
          .listIndexes()
          .toArray()
          .catch(() => [])) as ExistingIndexInfo[];

        const plan = this.planCreatesOrFail(desired, existing, {
          dtoName: name,
          mongoDb: this.params.mongoDb,
          collectionName,
        });

        if (plan.toCreate.length === 0) {
          log?.info?.(
            {
              event: "db_index_ensure_noop",
              mongoDb: this.params.mongoDb,
              collectionName,
              dto: name,
              desiredCount: desired.length,
              existingCount: existing.length,
              satisfiedCount: plan.satisfiedCount,
            },
            "IndexGate ensure complete (no-op; all indexes satisfied)"
          );
          return;
        }

        // Create only truly missing indexes.
        await col.createIndexes(plan.toCreate);

        log?.info?.(
          {
            event: "db_index_ensure_done",
            mongoDb: this.params.mongoDb,
            collectionName,
            dto: name,
            createdCount: plan.toCreate.length,
            satisfiedCount: plan.satisfiedCount,
          },
          "IndexGate ensure complete"
        );
      } catch (err) {
        const detail =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);

        throw new Error(
          `DB_INDEX_ENSURE_FAILED: Failed to ensure indexes for dto=${name} collection="${collectionName}" db="${this.params.mongoDb}". ` +
            `Detail: ${detail} ` +
            "Ops/Dev: verify DB connectivity and index hint correctness."
        );
      } finally {
        try {
          await client.close();
        } catch {
          // ignore
        }
      }
    });
  }

  /**
   * Decide which desired indexes must be created.
   *
   * Policy:
   * - If an equivalent index exists (same key spec + same uniqueness), it is satisfied
   *   EVEN IF the name differs (e.g., Mongo default env_1 vs our ix_env_service_env).
   * - If the key spec matches but uniqueness differs, hard-fail (real contract violation).
   */
  private planCreatesOrFail(
    desired: MongoIndexModel[],
    existing: ExistingIndexInfo[],
    ctx: { dtoName: string; mongoDb: string; collectionName: string }
  ): { toCreate: MongoIndexModel[]; satisfiedCount: number } {
    const toCreate: MongoIndexModel[] = [];
    let satisfiedCount = 0;

    for (const want of desired) {
      const wantKey = this.normalizeKeySpec(want.key);
      const wantUnique = want.unique === true;

      let foundEquivalent = false;

      for (const ex of existing) {
        const exKeyObj = (ex?.key ?? {}) as Record<string, unknown>;

        // Skip non-standard entries.
        if (!exKeyObj || typeof exKeyObj !== "object") continue;

        const exKey = this.normalizeKeySpec(exKeyObj);
        if (!this.keysEqual(exKey, wantKey)) continue;

        const exUnique = ex?.unique === true;

        if (exUnique !== wantUnique) {
          const exName = typeof ex?.name === "string" ? ex.name : "unknown";
          const wantName =
            typeof want.name === "string" && want.name.trim()
              ? want.name.trim()
              : "unnamed";

          throw new Error(
            `DB_INDEX_CONTRACT_VIOLATION: Index key spec already exists but uniqueness differs for dto=${ctx.dtoName} ` +
              `collection="${ctx.collectionName}" db="${ctx.mongoDb}". ` +
              `Existing index name="${exName}" unique=${String(
                exUnique
              )}; desired name="${wantName}" unique=${String(wantUnique)}. ` +
              "Ops/Dev: fix indexHints or reconcile the existing index definition (do NOT rely on boot to drop/rename)."
          );
        }

        // Equivalent index exists; name differences are ignored.
        foundEquivalent = true;
        break;
      }

      if (foundEquivalent) {
        satisfiedCount += 1;
        continue;
      }

      toCreate.push(want);
    }

    return { toCreate, satisfiedCount };
  }

  private hintsToIndexModels(hints: ReadonlyArray<unknown>): MongoIndexModel[] {
    const out: MongoIndexModel[] = [];

    for (const h of hints) {
      const hint = h as Partial<MongoIndexHint>;
      const kind = hint?.kind;
      const fields = Array.isArray(hint?.fields) ? hint!.fields : [];

      if (
        (kind !== "unique" && kind !== "lookup") ||
        fields.length === 0 ||
        fields.some((f) => !f || !String(f).trim())
      ) {
        continue; // ignore unknown/invalid hints
      }

      const key: Record<string, 1> = {};
      for (const f of fields) key[String(f).trim()] = 1;

      const name =
        hint?.options && typeof hint.options === "object"
          ? (hint.options as any)?.name
          : undefined;

      const model: MongoIndexModel = {
        key,
      };

      if (typeof name === "string" && name.trim()) {
        model.name = name.trim();
      }

      // IMPORTANT:
      // Only include `unique` if it is explicitly true.
      if (kind === "unique") {
        model.unique = true;
      }

      out.push(model);
    }

    return out;
  }

  /**
   * Normalize Mongo "key" objects into a stable comparable representation.
   * We keep order because compound index order matters.
   */
  private normalizeKeySpec(
    key: Record<string, unknown>
  ): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const k of Object.keys(key ?? {})) {
      const v = (key as any)[k];
      out.push([String(k), String(v)]);
    }
    return out;
  }

  private keysEqual(
    a: Array<[string, string]>,
    b: Array<[string, string]>
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] !== b[i][0]) return false;
      if (a[i][1] !== b[i][1]) return false;
    }
    return true;
  }
}
