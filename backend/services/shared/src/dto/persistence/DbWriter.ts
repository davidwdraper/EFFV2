// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/0041/0042/0043/0048
 *
 * Purpose:
 * - Concrete writer: uses **SvcEnvDto** to connect and write dto.toJson().
 * - Collection name is resolved explicitly from the DTO class (dbCollectionName()).
 * - Normalizes DB response ids to strings on the way back.
 * - Centralizes duplicate-key mapping.
 *
 * Invariants:
 * - No implicit fallbacks; Dev == Prod. Missing env/config → fail fast.
 */

import type { BaseDto } from "../DtoBase";
import { DbManagerBase } from "./DbManagerBase";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "./adapters/mongo/dupeKeyError";
import { coerceForMongoQuery } from "./adapters/mongo/queryHelper";
import type { SvcEnvDto } from "../svcenv.dto";
import { MongoClient, Collection, Db, ObjectId } from "mongodb";
import { DtoBag } from "@nv/shared/dto/DtoBag";

/* ----------------- minimal pooled client (per-process) ----------------- */
let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;

async function getExplicitCollection(
  svcEnv: SvcEnvDto,
  collectionName: string
): Promise<Collection> {
  const uri = svcEnv.getEnvVar("NV_MONGO_URI");
  const dbName = svcEnv.getEnvVar("NV_MONGO_DB");

  if (!uri || !dbName || !collectionName) {
    throw new Error(
      "DBWRITER_MISCONFIG: NV_MONGO_URI/NV_MONGO_DB/collectionName required. " +
        "Ops: verify svcenv configuration; no defaults permitted."
    );
  }

  if (!_client) {
    _client = new MongoClient(uri);
    await _client.connect();
    _db = _client.db(dbName);
    _dbNamePinned = dbName;
  } else if (_dbNamePinned !== dbName) {
    throw new Error(
      `DBWRITER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${dbName}". ` +
        "Ops: a single process must target one DB; restart with consistent env."
    );
  }

  return (_db as Db).collection(collectionName);
}

/* ---------------------------------------------------------------------- */

export class DbWriter<TDto extends BaseDto> extends DbManagerBase<TDto> {
  constructor(params: { dto: TDto; svcEnv: SvcEnvDto }) {
    super(params);
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const dtoCtor = this._dto.constructor as unknown as {
      dbCollectionName: () => string;
      name?: string;
    };
    const collectionName = dtoCtor.dbCollectionName();
    if (!collectionName?.trim()) {
      throw new Error(
        `DBWRITER_NO_COLLECTION: DTO ${
          dtoCtor.name ?? "<anon>"
        } returned empty dbCollectionName(). Ops: ensure BaseDto.configureEnv(...) was called at boot and dbCollectionKey() is mapped.`
      );
    }
    return { collectionName };
  }

  /** Persist the injected DTO using env-provided connection info. */
  public async write(): Promise<{ id: string }> {
    const dtoCtor = this._dto.constructor as unknown as {
      dbCollectionName: () => string;
      name?: string;
    };
    const collectionName = dtoCtor.dbCollectionName();
    if (!collectionName?.trim()) {
      throw new Error(
        `DBWRITER_NO_COLLECTION: DTO ${
          dtoCtor.name ?? "<anon>"
        } returned empty dbCollectionName().`
      );
    }
    const coll = await getExplicitCollection(this._svcEnv, collectionName);

    try {
      const res = await coll.insertOne(this._dto.toJson() as any);
      const id = String(res?.insertedId ?? "");
      if (!id) {
        throw new Error(
          "DbWriter.write() missing insertedId. Ops: check Mongo driver response and collection write concerns."
        );
      }
      return { id };
    } catch (err) {
      const dup = parseDuplicateKey(err);
      if (dup) throw new DuplicateKeyError(dup, err as Error);
      throw err;
    }
  }

  /**
   * Batch write: persists each DTO from the provided DtoBag.
   * Collection is resolved **per DTO** via its constructor.dbCollectionName().
   * Returns ids in the same order as input DTOs.
   */
  public async writeMany(bag: DtoBag<TDto>): Promise<{ ids: string[] }> {
    const ids: string[] = [];

    for (const dto of bag.items()) {
      const dtoCtor = (dto as any).constructor as {
        dbCollectionName: () => string;
        name?: string;
      };
      const collectionName = dtoCtor.dbCollectionName();
      if (!collectionName?.trim()) {
        throw new Error(
          `DBWRITER_NO_COLLECTION: DTO ${
            dtoCtor.name ?? "<anon>"
          } returned empty dbCollectionName() during writeMany().`
        );
      }
      const coll = await getExplicitCollection(this._svcEnv, collectionName);
      try {
        const res = await coll.insertOne((dto as BaseDto).toJson() as any);
        const id = String(res?.insertedId ?? "");
        if (!id) {
          throw new Error(
            "DbWriter.writeMany() missing insertedId. Ops: check Mongo driver response and collection write concerns."
          );
        }
        ids.push(id);
      } catch (err) {
        const dup = parseDuplicateKey(err);
        if (dup) throw new DuplicateKeyError(dup, err as Error);
        throw err;
      }
    }

    return { ids };
  }

  /**
   * Update the injected DTO by its id using $set of dto.toJson() (excluding _id).
   * Returns the id on success; throws on 0 matches.
   */
  public async update(): Promise<{ id: string }> {
    const dtoCtor = this._dto.constructor as unknown as {
      dbCollectionName: () => string;
      name?: string;
    };
    const collectionName = dtoCtor.dbCollectionName();
    if (!collectionName?.trim()) {
      throw new Error(
        `DBWRITER_NO_COLLECTION: DTO ${
          dtoCtor.name ?? "<anon>"
        } returned empty dbCollectionName().`
      );
    }
    const coll = await getExplicitCollection(this._svcEnv, collectionName);

    const json = this._dto.toJson() as Record<string, unknown>;
    const rawId =
      (json?._id as string | undefined) ??
      ((this._dto as any).xxxId as string | undefined) ??
      ((this._dto as any).id as string | undefined);

    if (!rawId || String(rawId).trim() === "") {
      throw new Error(
        "DbWriter.update() missing id. Ops: ensure DTO carries _id (or exposes an id getter) before update()."
      );
    }

    const { _id, ...rest } = json;

    // Coerce and type the Mongo _id as ObjectId for the driver.
    const filter = coerceForMongoQuery({ _id: String(rawId) }) as {
      _id: ObjectId;
    };

    try {
      const res = await coll.updateOne({ _id: filter._id }, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        throw new Error(
          `DbWriter.update() matched 0 documents for _id=${String(
            rawId
          )}. Ops: record may have been deleted; re-read before updating.`
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
