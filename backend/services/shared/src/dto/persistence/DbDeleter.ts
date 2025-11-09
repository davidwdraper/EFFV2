// backend/services/shared/src/dto/persistence/DbDeleter.ts
/**
 * Docs:
 * - SOP: DTO-first; single-concern helpers live in @nv/shared
 * - ADRs:
 *   - ADR-0040/0041/0042/0043 (DTO-only persistence, per-route controllers, HandlerContext bus, finalize)
 *   - ADR-0048 (Revised) — Reader/Writer/Deleter contracts at adapter edge
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0056 (DELETE uses <DtoTypeKey>; controller resolves collection)
 *
 * Purpose:
 * - Shared deleter that mirrors DbWriter/DbReader connectivity rules.
 * - Delete by canonical id (string). Adapter edge performs ObjectId coercion.
 *
 * Invariants:
 * - Canonical id name is strictly "id".
 * - No defaults: mongoUri/mongoDb must be provided explicitly by the caller
 *   (typically via EnvServiceDto.getEnvVar()).
 * - No DTO/Bag requirement; callers provide the explicit collection name.
 */

import { MongoClient, Collection, Db, ObjectId } from "mongodb";
import { coerceForMongoQuery } from "./adapters/mongo/queryHelper";

/* ----------------- minimal pooled client (per-process) ----------------- */
let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;
let _uriPinned: string | null = null;

async function getExplicitCollection(
  mongoUri: string,
  mongoDbName: string,
  collectionName: string
): Promise<Collection> {
  if (!mongoUri || !mongoDbName || !collectionName?.trim()) {
    throw new Error(
      "DBDELETER_MISCONFIG: mongoUri/mongoDb/collectionName required. " +
        "Ops: verify env-service configuration for this service; no defaults are permitted."
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
        `DBDELETER_URI_MISMATCH: Previously pinned URI="${_uriPinned}", new URI="${mongoUri}". ` +
          "Ops: a single process must target one DB URI; restart with consistent configuration."
      );
    }
    if (_dbNamePinned !== mongoDbName) {
      throw new Error(
        `DBDELETER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${mongoDbName}". ` +
          "Ops: a single process must target one DB; restart with consistent configuration."
      );
    }
  }

  return (_db as Db).collection(collectionName);
}

/* --------------------------- Deleter ----------------------------------- */

export class DbDeleter {
  private readonly _mongoUri: string;
  private readonly _mongoDb: string;
  private readonly _collectionName: string;

  /**
   * Construct a deleter bound to a specific collection.
   * Callers pass:
   *  - mongoUri / mongoDb (usually sourced from EnvServiceDto.getEnvVar)
   *  - collectionName (resolved upstream e.g. via Registry.dbCollectionNameByType()).
   */
  constructor(params: {
    mongoUri: string;
    mongoDb: string;
    collectionName: string;
  }) {
    this._mongoUri = params.mongoUri;
    this._mongoDb = params.mongoDb;
    this._collectionName = params.collectionName;
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    return { collectionName: this._collectionName };
  }

  /**
   * Delete a single document by canonical id.
   * Returns { deleted, id } where deleted is 0 or 1.
   */
  public async deleteById(
    id: string
  ): Promise<{ deleted: number; id: string }> {
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(
        "DBDELETER_BAD_ID: deleteById requires a non-empty string id. " +
          "Caller: validate inputs before persistence."
      );
    }

    const coll = await getExplicitCollection(
      this._mongoUri,
      this._mongoDb,
      this._collectionName
    );

    // Adapter-edge coercion to {_id: ObjectId|string} as needed.
    const filter = coerceForMongoQuery({ _id: String(id) }) as {
      _id: ObjectId;
    };

    const res = await coll.deleteOne({ _id: filter._id });
    const deleted =
      typeof res?.deletedCount === "number" ? res.deletedCount : 0;

    return { deleted, id };
  }

  /**
   * Convenience one-shot: delete by id without keeping an instance around.
   * Exactly mirrors deleteById() semantics.
   */
  public static async deleteOne(params: {
    mongoUri: string;
    mongoDb: string;
    collectionName: string;
    id: string;
  }): Promise<{ deleted: number; id: string }> {
    const { mongoUri, mongoDb, collectionName, id } = params;
    if (!collectionName?.trim()) {
      throw new Error(
        "DBDELETER_NO_COLLECTION: deleteOne requires a non-empty collectionName."
      );
    }
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(
        "DBDELETER_BAD_ID: deleteOne requires a non-empty string id. " +
          "Caller: validate inputs before persistence."
      );
    }

    const coll = await getExplicitCollection(mongoUri, mongoDb, collectionName);
    const filter = coerceForMongoQuery({ _id: String(id) }) as {
      _id: ObjectId;
    };
    const res = await coll.deleteOne({ _id: filter._id });
    const deleted =
      typeof res?.deletedCount === "number" ? res.deletedCount : 0;
    return { deleted, id };
  }
}
