// backend/services/shared/src/dto/persistence/dbDeleter/DbDeleter.ts
/**
 * Docs:
 * - SOP: DTO-first; single-concern helpers live in @nv/shared
 * - ADRs:
 *   - ADR-0040/0041/0042/0043 (DTO-only persistence, per-route controllers, HandlerContext bus, finalize)
 *   - ADR-0048 (Revised) — Reader/Writer/Deleter contracts at adapter edge
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id" on wire)
 *   - ADR-0056 (DELETE uses <DtoTypeKey>; controller resolves collection)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar())
 *   - ADR-0106 (Lazy index ensure via persistence IndexGate)
 *
 * Purpose:
 * - Public DbDeleter facade used by handlers.
 * - Delegates to an IDbDeleterWorker.
 * - Default worker is MongoDbDeleterWorker.
 *
 * ADR-0106:
 * - This facade MUST ensure indexes via rt.getCap("db.indexGate") before DB ops.
 * - This facade MUST source DB config via SvcRuntime (no param sprawl).
 */

import type { SvcRuntime } from "../../../runtime/SvcRuntime";
import type { IIndexGate } from "../indexes/IndexGate";
import type { IDbDeleterWorker } from "./DbDeleter.mongoWorker";
import { MongoDbDeleterWorker } from "./DbDeleter.mongoWorker";

/**
 * Handler-facing DTO ctor contract (ADR-0106):
 * - Handlers MUST NOT mention index concepts/types.
 * - DbDeleter accepts a minimal ctor for collection targeting; index contracts
 *   are validated internally and used only at the DB boundary.
 */
export type DbDeleteDtoCtor = {
  dbCollectionName: () => string;
  name?: string;
};

/** Internal-only contract required to interact with IndexGate (ADR-0106). */
type DbDeleteDtoCtorWithIndex = DbDeleteDtoCtor & {
  indexHints: ReadonlyArray<unknown>;
};

export class DbDeleter {
  private readonly rt: SvcRuntime;

  // Keep both views:
  // - handler-facing (no index typing)
  // - internal (validated to include indexHints)
  private readonly dtoCtor: DbDeleteDtoCtor;
  private readonly dtoCtorWithIndex: DbDeleteDtoCtorWithIndex;

  private readonly worker: IDbDeleterWorker;

  /**
   * Construct a deleter bound to a specific DTO's collection.
   * DB connectivity is sourced from rt (ADR-0074).
   */
  constructor(params: {
    rt: SvcRuntime;
    dtoCtor: DbDeleteDtoCtor;
    worker?: IDbDeleterWorker;
  }) {
    this.rt = params.rt;
    this.dtoCtor = params.dtoCtor;

    // Validate once up-front so ensureIndexes() can call IndexGate safely.
    this.dtoCtorWithIndex = this.requireDtoIndexContract(params.dtoCtor);

    if (params.worker) {
      this.worker = params.worker;
      return;
    }

    const mongoUri = this.rt.getDbVar("NV_MONGO_URI");
    const mongoDb = this.rt.getDbVar("NV_MONGO_DB");

    const collectionName = this.dtoCtor.dbCollectionName();
    if (!collectionName?.trim()) {
      throw new Error(
        `DBDELETER_EMPTY_COLLECTION: dtoCtor "${
          this.dtoCtor.name ?? "<anon>"
        }" returned empty dbCollectionName(). Dev: hard-wire a non-empty string.`
      );
    }

    this.worker = new MongoDbDeleterWorker({
      mongoUri,
      mongoDb,
      collectionName,
    });
  }

  /** ADR-0106: ensure indexes before any DB operation. */
  private async ensureIndexes(): Promise<void> {
    const gate = this.rt.getCap<IIndexGate>("db.indexGate");
    await gate.ensureForDtoCtor(this.dtoCtorWithIndex as unknown as any);
  }

  /**
   * ADR-0106: Runtime contract enforcement (handler must remain ignorant).
   * Throws actionable errors if a non-DB DTO (or malformed ctor) is used at the DB boundary.
   */
  private requireDtoIndexContract(
    dtoCtor: DbDeleteDtoCtor
  ): DbDeleteDtoCtorWithIndex {
    const name = this.safeCtorName(dtoCtor);

    if (!dtoCtor || typeof dtoCtor !== "object") {
      throw new Error(
        `DbDeleter(dtoCtor): expected an object ctor, got ${typeof dtoCtor} (dto=${name}).`
      );
    }
    if (typeof dtoCtor.dbCollectionName !== "function") {
      throw new Error(
        `DbDeleter(dtoCtor): missing dbCollectionName() function (dto=${name}).`
      );
    }

    const anyCtor = dtoCtor as unknown as { indexHints?: unknown };
    const hints = anyCtor.indexHints;

    if (!Array.isArray(hints)) {
      throw new Error(
        `DbDeleter(dtoCtor): DTO is missing index contract (indexHints[]). ` +
          `Only DB DTOs are valid for persistence ops. (dto=${name}, collection=${dtoCtor.dbCollectionName()})`
      );
    }

    return dtoCtor as unknown as DbDeleteDtoCtorWithIndex;
  }

  private safeCtorName(dtoCtor: DbDeleteDtoCtor): string {
    try {
      return (dtoCtor as any)?.name ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    await this.ensureIndexes();
    return this.worker.targetInfo();
  }

  /**
   * Delete a single document by canonical id.
   * Returns { deleted, id } where deleted is 0 or 1.
   */
  public async deleteById(
    id: string
  ): Promise<{ deleted: number; id: string }> {
    await this.ensureIndexes();
    return this.worker.deleteById(id);
  }

  /**
   * Convenience one-shot: delete by id without keeping an instance around.
   * Mirrors deleteById() semantics.
   */
  public static async deleteOne(params: {
    rt: SvcRuntime;
    dtoCtor: DbDeleteDtoCtor;
    id: string;
  }): Promise<{ deleted: number; id: string }> {
    const deleter = new DbDeleter({
      rt: params.rt,
      dtoCtor: params.dtoCtor,
    });
    return deleter.deleteById(params.id);
  }
}
