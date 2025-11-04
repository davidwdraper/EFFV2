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
 * - No defaults: NV_MONGO_URI/NV_MONGO_DB must come from SvcEnvDto.
 * - No DTO/Bag requirement; callers provide the explicit collection name.
 */

import type { SvcEnvDto } from "../svcenv.dto";
import { MongoClient, Collection, Db, ObjectId } from "mongodb";
import { coerceForMongoQuery } from "./adapters/mongo/queryHelper";

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

  if (!uri || !dbName || !collectionName?.trim()) {
    throw new Error(
      "DBDELETER_MISCONFIG: NV_MONGO_URI/NV_MONGO_DB/collectionName required. " +
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
      `DBDELETER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${dbName}". ` +
        "Ops: a single process must target one DB; restart with consistent env."
    );
  }

  return (_db as Db).collection(collectionName);
}

/* --------------------------- Deleter ----------------------------------- */

export class DbDeleter {
  private readonly _svcEnv: SvcEnvDto;
  private readonly _collectionName: string;

  /**
   * Construct a deleter bound to a specific collection.
   * Callers pass the collection name resolved upstream (e.g., Registry.dbCollectionNameByType()).
   */
  constructor(params: { svcEnv: SvcEnvDto; collectionName: string }) {
    this._svcEnv = params.svcEnv;
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
      this._svcEnv,
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
    svcEnv: SvcEnvDto;
    collectionName: string;
    id: string;
  }): Promise<{ deleted: number; id: string }> {
    const { svcEnv, collectionName, id } = params;
    if (!collectionName?.trim()) {
      throw new Error(
        "DBDELETER_NO_COLLECTION: deleteOne requires a non-empty collectionName."
      );
    }
    const coll = await getExplicitCollection(svcEnv, collectionName);
    const filter = coerceForMongoQuery({ _id: String(id) }) as {
      _id: ObjectId;
    };
    const res = await coll.deleteOne({ _id: filter._id });
    const deleted =
      typeof res?.deletedCount === "number" ? res.deletedCount : 0;
    return { deleted, id };
  }
}
