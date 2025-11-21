// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0045 (Index Hints ensured at boot)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are UUIDv4; assign BEFORE toJson; immutable thereafter)
 *
 * Purpose:
 * - Persist DTOs from a **DtoBag** with explicit Mongo connectivity.
 * - On create (write): always **insertOne** (no upsert). Singleton bag only.
 * - On _id duplicate: **clone()**, ensure a NEW UUIDv4 via DtoBase, retry (max 3).
 *
 * Meta rules:
 * - Create:
 *     • createdAt: stamped only if missing (DTO can pre-set it).
 *     • ownerUserId: stamped only once, from userId when present.
 *     • updatedAt: always stamped.
 *     • updatedByUserId: set only when userId is provided.
 * - Update:
 *     • createdAt / ownerUserId: left unchanged.
 *     • updatedAt / updatedByUserId: refreshed each update (from userId when present).
 *
 * Returns:
 * - For write(): a **singleton DtoBag<TDto>** containing the exact DTO that was inserted
 *   (either the original instance or the clone used on retry).
 * - For writeMany(): a **DtoBag<TDto>** containing every DTO that was inserted.
 *
 * Ground rules (ID handling):
 * - Internally, DTOs manage their canonical id via DtoBase’s `_id` / setIdOnce()/ensureId().
 * - Outbound wire JSON from DTOs includes `_id` (string). There is no separate DB-only id.
 * - Writer does **no** id mapping: it inserts the DTO’s JSON as-is and trusts `_id`.
 */

import type { DtoBase } from "../DtoBase";
import type { ILogger } from "../../logger/Logger";
import { MongoClient, Collection, Db } from "mongodb";
import { DtoBag } from "../../dto/DtoBag";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "./adapters/mongo/dupeKeyError";

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
        `DBWRITER_URI_MISMATCH: Previously pinned URI="${_uriPinned}", new URI="${mongoUri}".`
      );
    }
    if (_dbNamePinned !== mongoDbName) {
      throw new Error(
        `DBWRITER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${mongoDbName}".`
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

/** Enforce clone invariants: same class, same collection; only `_id` may differ. */
function assertCloneInvariants(before: DtoBase, after: DtoBase): void {
  const beforeCtor = (before as any)?.constructor;
  const afterCtor = (after as any)?.constructor;
  if (beforeCtor !== afterCtor) {
    throw new Error(
      "DBWRITER_CLONE_INVARIANT: clone() changed DTO class. Only `_id` may change."
    );
  }
  const beforeColl = before.requireCollectionName();
  const afterColl = after.requireCollectionName();
  if (beforeColl !== afterColl) {
    throw new Error(
      `DBWRITER_CLONE_INVARIANT: clone() changed dbCollectionName() from "${beforeColl}" to "${afterColl}".`
    );
  }
}

/** Heuristic: does a parsed duplicate refer to the _id key/index? */
function isIdDuplicate(dup: any): boolean {
  if (!dup) return false;
  const key = String(dup.key ?? "").toLowerCase();
  const index = String(dup.index ?? "").toLowerCase();
  if (key === "_id" || index === "_id_") return true;
  if (dup.fields && typeof dup.fields === "object" && "_id" in dup.fields)
    return true;
  return false;
}

/* ---------------------------------------------------------------------- */

export class DbWriter<TDto extends DtoBase> {
  private readonly _bag: DtoBag<TDto>;
  private readonly _mongoUri: string;
  private readonly _mongoDb: string;
  private readonly _userId?: string;
  private readonly log: ILogger;

  constructor(params: {
    bag: DtoBag<TDto>;
    mongoUri: string;
    mongoDb: string;
    log?: ILogger;
    userId?: string;
  }) {
    this._bag = params.bag;
    this._mongoUri = params.mongoUri;
    this._mongoDb = params.mongoDb;
    this._userId = params.userId;
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
   * Assign meta + id BEFORE toJson.
   */
  public async write(): Promise<DtoBag<TDto>> {
    let dto = requireSingleton(this._bag, "write");
    let collectionName = (dto as DtoBase).requireCollectionName();
    let coll = await getExplicitCollection(
      this._mongoUri,
      this._mongoDb,
      collectionName
    );

    for (let attempt = 1; attempt <= MAX_DUP_RETRIES; attempt++) {
      try {
        const base = dto as DtoBase;

        // Meta first: createdAt/ownerUserId (one-shot), updatedAt/updatedByUserId.
        base.stampCreatedAt();
        base.stampOwnerUserId(this._userId);
        base.stampUpdatedAt(this._userId);

        // Ensure id BEFORE toJson (DtoBase handles generation/validation)
        base.ensureId();

        // Outbound wire already contains `_id`; writer does no transformations.
        const json = base.toJson() as Record<string, unknown>;
        const wireId = String((json as any)._id ?? "");
        if (!wireId) {
          throw new Error(
            "DBWRITER_WRITE_NO_WIRE_ID: toJson() did not include `_id`."
          );
        }

        const res = await coll.insertOne(json as any);
        const insertedId = String(res?.insertedId ?? "");
        if (!insertedId) {
          throw new Error(
            "DBWRITER_WRITE_NO_ID: insertOne returned no insertedId."
          );
        }

        // Success — return a bag containing the exact DTO we inserted
        return new DtoBag<TDto>([dto as TDto]);
      } catch (err) {
        const dup = parseDuplicateKey(err);
        if (!dup) {
          this.log.error(
            {
              attempt,
              collection: collectionName,
              err: (err as Error)?.message,
            },
            "dbwriter: insert failed (non-duplicate)"
          );
          throw err;
        }

        const idDup = isIdDuplicate(dup);
        this.log.warn(
          {
            attempt,
            collection: collectionName,
            code: 11000,
            detail: dup,
            idDuplicate: idDup,
          },
          "dbwriter: duplicate key"
        );

        // Non-_id unique violation → surface immediately
        if (!idDup) throw new DuplicateKeyError(dup, err as Error);

        // _id duplicate — retry with clone + NEW UUID
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

          // Fresh meta + id on the clone.
          cloned.stampCreatedAt();
          cloned.stampOwnerUserId(this._userId);
          cloned.stampUpdatedAt(this._userId);
          cloned.ensureId();

          dto = cloned as TDto;

          // safety: collection should remain identical
          const nextCollection = (dto as DtoBase).requireCollectionName();
          if (nextCollection !== collectionName) {
            this.log.warn(
              { from: collectionName, to: nextCollection },
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
    throw new Error(
      "DBWRITER_WRITE_EXHAUSTED: exhausted duplicate retries without success."
    );
  }

  /**
   * Batch insert with per-item duplicate handling.
   * Returns a DtoBag containing all successfully inserted DTOs (with any retried clones).
   */
  public async writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>> {
    const source = bag ?? this._bag;

    const inserted: TDto[] = [];

    for (const _item of source.items()) {
      let dto = _item as TDto;
      let collectionName = (dto as DtoBase).requireCollectionName();
      let coll = await getExplicitCollection(
        this._mongoUri,
        this._mongoDb,
        collectionName
      );

      let insertedOk = false;
      for (
        let attempt = 1;
        attempt <= MAX_DUP_RETRIES && !insertedOk;
        attempt++
      ) {
        try {
          const base = dto as DtoBase;

          base.stampCreatedAt();
          base.stampOwnerUserId(this._userId);
          base.stampUpdatedAt(this._userId);
          base.ensureId();

          const json = base.toJson() as Record<string, unknown>;
          const wireId = String((json as any)._id ?? "");
          if (!wireId) {
            throw new Error(
              "DBWRITER_WRITE_MANY_NO_WIRE_ID: toJson() did not include `_id`."
            );
          }

          const res = await coll.insertOne(json as any);
          const insertedId = String(res?.insertedId ?? "");
          if (!insertedId) {
            throw new Error(
              "DBWRITER_WRITE_MANY_NO_ID: insertOne returned no insertedId."
            );
          }

          inserted.push(dto as TDto);
          insertedOk = true;
        } catch (err) {
          const dup = parseDuplicateKey(err);
          if (!dup) {
            this.log.error(
              {
                attempt,
                collection: collectionName,
                err: (err as Error)?.message,
              },
              "dbwriter: insert failed (many, non-duplicate)"
            );
            throw err;
          }

          const idDup = isIdDuplicate(dup);
          this.log.warn(
            {
              attempt,
              collection: collectionName,
              code: 11000,
              detail: dup,
              idDuplicate: idDup,
            },
            "dbwriter: duplicate key (many)"
          );

          if (!idDup) throw new DuplicateKeyError(dup, err as Error);

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

            cloned.stampCreatedAt();
            cloned.stampOwnerUserId(this._userId);
            cloned.stampUpdatedAt(this._userId);
            cloned.ensureId();

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

    return new DtoBag<TDto>(inserted);
  }

  /** Update by canonical id (no id mutation). */
  public async update(): Promise<{ id: string }> {
    const dto = requireSingleton(this._bag, "update");
    const collectionName = (dto as DtoBase).requireCollectionName();
    const coll = await getExplicitCollection(
      this._mongoUri,
      this._mongoDb,
      collectionName
    );

    const base = dto as DtoBase;

    // Must already be set; no generation on update.
    const rawId = base.getId();

    // Refresh update meta only; createdAt/ownerUserId stay as-is.
    base.stampUpdatedAt(this._userId);

    const json = base.toJson() as Record<string, unknown>;
    const { _id, id: _wireId, ...rest } = json as Record<string, unknown>;

    const filter = { _id: String(rawId) };

    try {
      const res = await coll.updateOne(filter as any, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        throw new Error(
          `DBWRITER_UPDATE_NO_MATCH: matched 0 documents for _id=${String(
            rawId
          )}`
        );
      }

      return { id: String(rawId) };
    } catch (err) {
      const dup = parseDuplicateKey(err);
      if (dup) throw new DuplicateKeyError(dup, err as Error);
      throw err;
    }
  }
}

export { DuplicateKeyError };
