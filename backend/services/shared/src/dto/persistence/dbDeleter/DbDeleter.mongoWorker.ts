// backend/services/shared/src/dto/persistence/dbDeleter/DbDeleter.mongoWorker.ts
/**
 * Docs:
 * - SOP: DTO-first; single-concern helpers live in @nv/shared
 * - ADRs:
 *   - ADR-0040/0041/0042/0043 (DTO-only persistence, per-route controllers, HandlerContext bus, finalize)
 *   - ADR-0048 (Revised) — Reader/Writer/Deleter contracts at adapter edge
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id" on wire)
 *   - ADR-0056 (DELETE uses <DtoTypeKey>; controller resolves collection)
 *
 * Purpose:
 * - Mongo-backed implementation of the deleter.
 * - Encapsulates Mongo connectivity and deletion semantics.
 * - DbDeleter facade delegates to this worker by default.
 *
 * Invariants:
 * - Canonical wire id field is `_id` (UUIDv4 string).
 * - No defaults: mongoUri/mongoDb must be provided explicitly.
 */

import { MongoClient, Collection, Db, Document } from "mongodb";

/** Wire doc type: ensure `_id` is a string so TS doesn't expect ObjectId. */
type WireDoc = Document & { _id: string };

/* ----------------- minimal pooled client (per-process) ----------------- */

let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;
let _uriPinned: string | null = null;

async function getExplicitCollection<T extends Document = WireDoc>(
  mongoUri: string,
  mongoDbName: string,
  collectionName: string
): Promise<Collection<T>> {
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

  return (_db as Db).collection<T>(collectionName);
}

/* --------------------------- Worker ----------------------------------- */

export interface IDbDeleterWorker {
  targetInfo(): Promise<{ collectionName: string }>;
  deleteById(id: string): Promise<{ deleted: number; id: string }>;
}

export class MongoDbDeleterWorker implements IDbDeleterWorker {
  private readonly mongoUri: string;
  private readonly mongoDb: string;
  private readonly collectionName: string;

  constructor(params: {
    mongoUri: string;
    mongoDb: string;
    collectionName: string;
  }) {
    this.mongoUri = params.mongoUri;
    this.mongoDb = params.mongoDb;
    this.collectionName = params.collectionName;
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    return { collectionName: this.collectionName };
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

    const coll = await getExplicitCollection<WireDoc>(
      this.mongoUri,
      this.mongoDb,
      this.collectionName
    );

    const res = await coll.deleteOne({ _id: String(id) } as Partial<WireDoc>);
    const deleted =
      typeof res?.deletedCount === "number" ? res.deletedCount : 0;

    return { deleted, id };
  }
}
