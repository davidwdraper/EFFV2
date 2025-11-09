// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric persistence
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (Revised) — Writers accept **DtoBag** only
 *   - ADR-0053 (Bag Purity) — no naked DTOs cross boundaries
 *   - ADR-0054 (Idempotent Create via clone-on-duplicate, fixed retries)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; assign BEFORE toJson; return id)
 *
 * Purpose:
 * - Persist DTOs from a **DtoBag** using explicit Mongo connectivity
 *   (mongoUri/mongoDb), typically sourced from EnvServiceDto.getEnvVar().
 * - Create (write) and update are **singleton-bag** operations in current controllers.
 * - Batch insert supported via writeMany(bag) with per-item duplicate handling.
 *
 * Invariants:
 * - Canonical **wire** id field is strictly "id" (string).
 * - DB `_id` is stored as the **same string** (UUIDv4). No ObjectId coercion.
 * - Adapter maps "id" → "_id" **exactly once** before insert; wire never leaks "_id".
 * - Collection comes from each DTO instance via requireCollectionName().
 * - Duplicate key errors are normalized to DuplicateKeyError.
 * - On duplicate during **write() / writeMany()**, we call `dto.clone()` and retry up to 3 times.
 *   Only the id can change; class and collection must remain identical — enforced below.
 */

import type { DtoBase } from "../DtoBase";
import type { ILogger } from "../../logger/Logger";
import { MongoClient, Collection, Db } from "mongodb";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "./adapters/mongo/dupeKeyError";
import { newUuid } from "../../utils/uuid";

/* ----------------- minimal pooled client (per-process) ----------------- */
let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;
let _uriPinned: string | null = null;

/** internal: tiny console-backed logger if none is provided */
function consoleLogger(ctx: Record<string, unknown> = {}): ILogger {
  const wrap =
    (level: "debug" | "info" | "warn" | "error") =>
    (meta?: unknown, msg?: string) => {
      const payload =
        meta && typeof meta === "object"
          ? { ...ctx, ...(meta as Record<string, unknown>) }
          : { ...ctx, meta };
      // eslint-disable-next-line no-console
      console[level](
        `[DbWriter] ${msg ?? ""}`.trim(),
        Object.keys(payload).length ? payload : undefined
      );
    };
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    child(_b: any) {
      return consoleLogger({ ...ctx, ...(_b ?? {}) });
    },
  } as unknown as ILogger;
}

async function getExplicitCollection(
  mongoUri: string,
  mongoDbName: string,
  collectionName: string
): Promise<Collection> {
  if (!mongoUri || !mongoDbName || !collectionName) {
    throw new Error(
      "DBWRITER_MISCONFIG: mongoUri/mongoDb/collectionName required. " +
        "Ops: verify env-service configuration for this service; no defaults permitted."
    );
  }

  if (!_client) {
    _client = new MongoClient(mongoUri);
    await _client.connect();
    _db = _client.db(mongoDbName);
    _dbNamePinned = mongoDbName;
    _uriPinned = mongoUri;
  } else {
    if (_uriPinned !== mongoUri) {
      throw new Error(
        `DBWRITER_URI_MISMATCH: Previously pinned URI="${_uriPinned}", new URI="${mongoUri}". ` +
          "Ops: a single process must target one DB URI; restart with consistent configuration."
      );
    }
    if (_dbNamePinned !== mongoDbName) {
      throw new Error(
        `DBWRITER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${mongoDbName}". ` +
          "Ops: a single process must target one DB; restart with consistent configuration."
      );
    }
  }

  return (_db as Db).collection(collectionName);
}

/* ----------------------- helpers ----------------------------- */

const MAX_DUP_RETRIES = 3;

function requireSingleton<TDto extends DtoBase>(
  bag: DtoBag<TDto>,
  op: "write" | "update"
): TDto {
  const items = Array.from(bag.items());
  if (items.length !== 1) {
    const msg =
      items.length === 0
        ? `${op}: singleton bag required; received 0 items`
        : `${op}: singleton bag required; received ${items.length} items`;
    throw new Error(`DBWRITER_SINGLETON_REQUIRED: ${msg}`);
  }
  return items[0] as TDto;
}

/** Enforce clone invariants: same class, same collection; only id may differ. */
function assertCloneInvariants(before: DtoBase, after: DtoBase): void {
  const beforeCtor = (before as any)?.constructor;
  const afterCtor = (after as any)?.constructor;
  if (beforeCtor !== afterCtor) {
    throw new Error(
      "DBWRITER_CLONE_INVARIANT: clone() changed DTO class. " +
        "Dev: clone must preserve type; only 'id' may change."
    );
  }
  const beforeColl = before.requireCollectionName();
  const afterColl = after.requireCollectionName();
  if (beforeColl !== afterColl) {
    throw new Error(
      `DBWRITER_CLONE_INVARIANT: clone() changed dbCollectionName() from "${beforeColl}" to "${afterColl}". ` +
        "Dev: collection identity must be immutable."
    );
  }
}

/**
 * Map wire id → DB _id (string) exactly once.
 * - Requires a non-empty string `id` on the input.
 * - Produces a doc with `_id:<string>` and removes `id`.
 * - Never persists both `id` and `_id`.
 */
function mapWireIdToMongoDoc(json: Record<string, unknown>): {
  doc: Record<string, unknown>;
  usedId: string;
} {
  const id = json["id"];
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(
      "DBWRITER_ID_MAPPING: missing id before insert. " +
        "Dev: ensure DTO carries a valid 'id' (string) prior to persistence."
    );
  }

  const doc: Record<string, unknown> = { ...json, _id: id };
  delete (doc as any).id;

  return { doc, usedId: id };
}

/* ---------------------------------------------------------------------- */

export class DbWriter<TDto extends DtoBase> {
  private readonly _bag: DtoBag<TDto>;
  private readonly _mongoUri: string;
  private readonly _mongoDb: string;
  private readonly log: ILogger;

  constructor(params: {
    bag: DtoBag<TDto>;
    mongoUri: string;
    mongoDb: string;
    log?: ILogger;
  }) {
    this._bag = params.bag;
    this._mongoUri = params.mongoUri;
    this._mongoDb = params.mongoDb;
    this.log = params.log ?? consoleLogger({ component: "DbWriter" });
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const dto = requireSingleton(this._bag, "write");
    const collectionName = (dto as DtoBase).requireCollectionName();
    return { collectionName };
  }

  /**
   * Insert a single DTO from the singleton bag.
   * Assign ID **before** toJson() if absent (ADR-0057).
   * On duplicate: clone() with a new id and retry up to MAX_DUP_RETRIES.
   * Instrumentation:
   *  - DEBUG before insert with collection and _id
   *  - DEBUG after insert with insertedId
   *  - WARN on duplicate, ERROR on unexpected failure
   */
  public async write(): Promise<{ id: string }> {
    let dto = requireSingleton(this._bag, "write");
    let collectionName = (dto as DtoBase).requireCollectionName();
    let coll = await getExplicitCollection(
      this._mongoUri,
      this._mongoDb,
      collectionName
    );

    for (let attempt = 1; attempt <= MAX_DUP_RETRIES; attempt++) {
      try {
        // ---- ID lifecycle (strictly BEFORE toJson) -------------------------
        this.log.debug(
          {
            op: "pre_hasId() test",
            haveId: (dto as DtoBase).hasId(),
            id: (dto as DtoBase).hasId() ? (dto as DtoBase).id : undefined,
          },
          "dbwriter: id status before toJson"
        );

        if (!dto.hasId()) {
          // setter validates UUIDv4 and lowercases
          (dto as DtoBase).id = newUuid();
        }
        const dtoId = (dto as DtoBase).id;

        this.log.debug(
          {
            op: "pre_toJson",
            haveId: (dto as DtoBase).hasId(),
            id: (dto as DtoBase).hasId() ? (dto as DtoBase).id : undefined,
          },
          "dbwriter: id status before toJson"
        );

        const json = (dto as DtoBase).toJson() as Record<string, unknown>;
        const mapped = mapWireIdToMongoDoc(json); // strips id → _id (string)

        this.log.debug(
          {
            op: "insertOne",
            attempt,
            collection: collectionName,
            willInsert: { _id: String(mapped.doc._id) },
          },
          "dbwriter: about to insert"
        );

        const res = await coll.insertOne(mapped.doc as any);

        const insertedId = String(res?.insertedId ?? "");
        if (!insertedId) {
          const msg =
            "DBWRITER_WRITE_NO_ID: insertOne returned no insertedId. " +
            "Ops: check write concerns and Mongo driver versions.";
          this.log.error({ collection: collectionName }, msg);
          throw new Error(msg);
        }

        this.log.debug(
          {
            op: "insertOne",
            attempt,
            collection: collectionName,
            insertedId,
          },
          "dbwriter: insert complete"
        );

        // Return canonical wire id we used
        return { id: dtoId };
      } catch (err) {
        const dup = parseDuplicateKey(err);
        if (!dup) {
          this.log.error(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              err: (err as Error)?.message,
            },
            "dbwriter: insert failed (non-duplicate)"
          );
          throw err;
        }

        // Duplicate key
        this.log.warn(
          {
            op: "insertOne",
            attempt,
            collection: collectionName,
            code: 11000,
            detail: dup,
          },
          "dbwriter: duplicate key"
        );

        if (attempt < MAX_DUP_RETRIES) {
          if (typeof (dto as any).clone !== "function") {
            this.log.warn(
              { collection: collectionName },
              "dbwriter: clone() not available; surfacing duplicate"
            );
            throw new DuplicateKeyError(dup, err as Error);
          }
          const cloned = (dto as any).clone() as DtoBase;
          assertCloneInvariants(dto as DtoBase, cloned as DtoBase);
          dto = cloned as TDto;

          // Sanity: collection should remain identical
          const nextCollection = (dto as DtoBase).requireCollectionName();
          if (nextCollection !== collectionName) {
            this.log.warn(
              {
                from: collectionName,
                to: nextCollection,
              },
              "dbwriter: collection changed across clone (unexpected)"
            );
            collectionName = nextCollection;
            coll = await getExplicitCollection(
              this._mongoUri,
              this._mongoDb,
              collectionName
            );
          }

          continue; // retry
        }

        // Exhausted retries
        throw new DuplicateKeyError(dup, err as Error);
      }
    }

    // Unreachable
    const msg =
      "DBWRITER_WRITE_EXHAUSTED: exhausted duplicate retries without success.";
    this.log.error({ msg }, "dbwriter: exhausted retries");
    throw new Error(msg);
  }

  /**
   * Batch insert with per-item duplicate handling.
   * IDs are ensured BEFORE toJson() on each item.
   */
  public async writeMany(bag?: DtoBag<TDto>): Promise<{ ids: string[] }> {
    const source = bag ?? this._bag;
    const ids: string[] = [];

    for (const _item of source.items()) {
      let dto = _item as TDto;
      let collectionName = (dto as DtoBase).requireCollectionName();
      let coll = await getExplicitCollection(
        this._mongoUri,
        this._mongoDb,
        collectionName
      );

      let inserted = false;
      for (
        let attempt = 1;
        attempt <= MAX_DUP_RETRIES && !inserted;
        attempt++
      ) {
        try {
          if (!(dto as DtoBase).hasId()) {
            (dto as DtoBase).id = newUuid();
          }
          const dtoId = (dto as DtoBase).id;

          const json = (dto as DtoBase).toJson() as Record<string, unknown>;
          const mapped = mapWireIdToMongoDoc(json);

          this.log.debug(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              willInsert: { _id: String(mapped.doc._id) },
            },
            "dbwriter: about to insert (many)"
          );

          const res = await coll.insertOne(mapped.doc as any);
          const insertedId = String(res?.insertedId ?? "");
          if (!insertedId) {
            const msg =
              "DBWRITER_WRITE_MANY_NO_ID: insertOne returned no insertedId. " +
              "Ops: check write concerns and Mongo driver versions.";
            this.log.error({ collection: collectionName }, msg);
            throw new Error(msg);
          }

          this.log.debug(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              insertedId,
            },
            "dbwriter: insert complete (many)"
          );

          ids.push(dtoId);
          inserted = true;
        } catch (err) {
          const dup = parseDuplicateKey(err);
          if (!dup) {
            this.log.error(
              {
                op: "insertOne",
                attempt,
                collection: collectionName,
                err: (err as Error)?.message,
              },
              "dbwriter: insert failed (many, non-duplicate)"
            );
            throw err;
          }

          this.log.warn(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              code: 11000,
              detail: dup,
            },
            "dbwriter: duplicate key (many)"
          );

          if (attempt < MAX_DUP_RETRIES) {
            if (typeof (dto as any).clone !== "function") {
              this.log.warn(
                { collection: collectionName },
                "dbwriter: clone() not available (many); surfacing duplicate"
              );
              throw new DuplicateKeyError(dup, err as Error);
            }
            const cloned = (dto as any).clone() as DtoBase;
            assertCloneInvariants(dto as DtoBase, cloned as DtoBase);
            dto = cloned as TDto;

            const nextCollection = (dto as DtoBase).requireCollectionName();
            if (nextCollection !== collectionName) {
              this.log.warn(
                { from: collectionName, to: nextCollection },
                "dbwriter: collection changed across clone (many, unexpected)"
              );
              collectionName = nextCollection;
              coll = await getExplicitCollection(
                this._mongoUri,
                this._mongoDb,
                collectionName
              );
            }
            continue;
          }

          throw new DuplicateKeyError(dup, err as Error);
        }
      }
    }

    return { ids };
  }

  /**
   * Update by canonical id:
   * - **No** id mutation.
   * - Uses string `_id` filter (UUIDv4), not ObjectId.
   */
  public async update(): Promise<{ id: string }> {
    const dto = requireSingleton(this._bag, "update");
    const collectionName = (dto as DtoBase).requireCollectionName();
    const coll = await getExplicitCollection(
      this._mongoUri,
      this._mongoDb,
      collectionName
    );

    // Require the id prior to serialization; do NOT generate on update.
    const rawId = (dto as DtoBase).id;

    const json = (dto as DtoBase).toJson() as Record<string, unknown>;
    const { _id, id: _wireId, ...rest } = json as Record<string, unknown>; // strip any leakage defensively

    const filter = { _id: String(rawId) };

    try {
      this.log.debug(
        { op: "updateOne", collection: collectionName, _id: String(rawId) },
        "dbwriter: about to update"
      );

      const res = await coll.updateOne(filter as any, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        const msg = `DBWRITER_UPDATE_NO_MATCH: matched 0 documents for _id=${String(
          rawId
        )}. Ops: record may have been deleted; re-read before updating.`;
        this.log.warn({ collection: collectionName, _id: String(rawId) }, msg);
        throw new Error(msg);
      }

      this.log.debug(
        { op: "updateOne", collection: collectionName, _id: String(rawId) },
        "dbwriter: update complete"
      );

      return { id: String(rawId) };
    } catch (err) {
      const dup = parseDuplicateKey(err);
      if (dup) {
        this.log.warn(
          {
            op: "updateOne",
            collection: collectionName,
            _id: String(rawId),
            code: 11000,
            detail: dup,
          },
          "dbwriter: duplicate key on update"
        );
        throw new DuplicateKeyError(dup, err as Error);
      }
      this.log.error(
        {
          op: "updateOne",
          collection: collectionName,
          _id: String(rawId),
          err: (err as Error)?.message,
        },
        "dbwriter: update failed"
      );
      throw err;
    }
  }
}

export { DuplicateKeyError };
