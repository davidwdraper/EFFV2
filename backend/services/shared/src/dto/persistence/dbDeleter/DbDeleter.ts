// backend/services/shared/src/dto/persistence/dbDeleter/DbDeleter.ts
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
 * - Public DbDeleter facade used by handlers.
 * - Mirrors the original API while delegating to an IDbDeleterWorker.
 * - Default worker is MongoDbDeleterWorker, preserving existing behavior.
 *
 * Invariants:
 * - Canonical wire id field is `_id` (UUIDv4 string).
 * - No defaults: mongoUri/mongoDb must be provided explicitly by the caller
 *   (typically via EnvServiceDto.getEnvVar()).
 * - No DTO/Bag requirement; callers provide the explicit collection name.
 */

import type { IDbDeleterWorker } from "./DbDeleter.mongoWorker";
import { MongoDbDeleterWorker } from "./DbDeleter.mongoWorker";

export class DbDeleter {
  private readonly worker: IDbDeleterWorker;

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
    worker?: IDbDeleterWorker;
  }) {
    this.worker =
      params.worker ??
      new MongoDbDeleterWorker({
        mongoUri: params.mongoUri,
        mongoDb: params.mongoDb,
        collectionName: params.collectionName,
      });
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    return this.worker.targetInfo();
  }

  /**
   * Delete a single document by canonical id.
   * Returns { deleted, id } where deleted is 0 or 1.
   */
  public async deleteById(
    id: string
  ): Promise<{ deleted: number; id: string }> {
    return this.worker.deleteById(id);
  }

  /**
   * Convenience one-shot: delete by id without keeping an instance around.
   * Exactly mirrors deleteById() semantics.
   *
   * NOTE:
   * - This uses the default MongoDbDeleterWorker via the facade, so future
   *   edge-mode injection still flows through here without changing callers.
   */
  public static async deleteOne(params: {
    mongoUri: string;
    mongoDb: string;
    collectionName: string;
    id: string;
  }): Promise<{ deleted: number; id: string }> {
    const { mongoUri, mongoDb, collectionName, id } = params;

    const deleter = new DbDeleter({
      mongoUri,
      mongoDb,
      collectionName,
    });

    return deleter.deleteById(id);
  }
}
