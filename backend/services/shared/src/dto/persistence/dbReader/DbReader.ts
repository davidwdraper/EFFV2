// backend/services/shared/src/dto/persistence/dbReader/DbReader.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; reads hydrate DTOs with validate=false by default
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (Revised) — All reads return DtoBag (singleton or empty)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar())
 *   - ADR-0106 (Lazy index ensure via persistence IndexGate)
 *
 * Purpose:
 * - Public DbReader<TDto> facade used by handlers.
 * - Delegates all behavior to an injected IDbReaderWorker<TDto>.
 * - Default worker is MongoDbReaderWorker<TDto>.
 *
 * ADR-0106:
 * - Facade ensures indexes via rt.getCap("db.indexGate") before DB ops.
 * - Facade sources DB config via SvcRuntime (no param sprawl).
 */

import type { OrderSpec } from "../../../db/orderSpec";
import { ORDER_STABLE_ID_ASC } from "../../../db/orderSpec";
import { DtoBag } from "../../../dto/DtoBag";
import { MongoDbReaderWorker } from "./DbReader.mongoWorker";
import type { SvcRuntime } from "../../../runtime/SvcRuntime";
import type { IIndexGate } from "../indexes/IndexGate";

/**
 * Handler-facing DTO ctor contract (ADR-0106):
 * - Handlers MUST NOT mention index concepts/types.
 * - Therefore, DbReader accepts an opaque ctor that can hydrate a DTO and
 *   declare a DB collection name; index contracts are validated internally.
 */
export type DbReadDtoCtor<T> = {
  fromBody: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string;
  name?: string;
};

/** Internal-only contract needed to interact with IndexGate (ADR-0106). */
type DbReadDtoCtorWithIndex<T> = DbReadDtoCtor<T> & {
  indexHints: ReadonlyArray<unknown>;
};

export type DbReaderOptions<T> = {
  rt: SvcRuntime;
  dtoCtor: DbReadDtoCtor<T>;
  validateReads?: boolean; // default false
};

export type ReadBatchArgs = {
  filter?: Record<string, unknown>;
  order?: OrderSpec; // default: ORDER_STABLE_ID_ASC
  limit: number;
  cursor?: string | null;
  rev?: boolean;
};

export type ReadBatchResult<TDto> = {
  bag: DtoBag<TDto>;
  nextCursor?: string;
};

/** Worker interface so we can inject Mongo/mock implementations. */
export interface IDbReaderWorker<TDto> {
  targetInfo(): Promise<{ collectionName: string }>;
  readOneBagById(opts: { id: string }): Promise<DtoBag<TDto>>;
  readOneBag(opts: { filter: Record<string, unknown> }): Promise<DtoBag<TDto>>;
  readManyBag(opts: {
    filter: Record<string, unknown>;
    limit?: number;
    order?: OrderSpec;
  }): Promise<DtoBag<TDto>>;
  readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>>;
}

/**
 * DbReader facade:
 * - Enforces ADR-0106: ensure indexes lazily at the DB boundary.
 * - Uses SvcRuntime for mongoUri/mongoDb retrieval (ADR-0074).
 *
 * IMPORTANT (ADR-0106):
 * - Handlers pass dtoCtor opaquely (no index typing).
 * - DbReader validates the DTO's index contract at runtime before calling IndexGate.
 */
export class DbReader<TDto> {
  private readonly worker: IDbReaderWorker<TDto>;
  private readonly rt: SvcRuntime;

  // Keep both views:
  // - handler-facing (no index typing)
  // - internal (validated to include indexHints)
  private readonly dtoCtor: DbReadDtoCtor<TDto>;
  private readonly dtoCtorWithIndex: DbReadDtoCtorWithIndex<TDto>;

  constructor(
    opts: DbReaderOptions<TDto> & { worker?: IDbReaderWorker<TDto> }
  ) {
    this.rt = opts.rt;
    this.dtoCtor = opts.dtoCtor;

    // Validate once up-front so:
    // - worker can depend on a stable ctor shape
    // - ensureIndexes() can call IndexGate without unsafe assumptions
    this.dtoCtorWithIndex = this.requireDtoIndexContract(opts.dtoCtor);

    if (opts.worker) {
      this.worker = opts.worker;
      return;
    }

    const mongoUri = this.rt.getDbVar("NV_MONGO_URI");
    const mongoDb = this.rt.getDbVar("NV_MONGO_DB");

    // Worker may need indexHints near dtoCtor for collection/index mapping;
    // handlers never type against it, but the actual ctor must supply it.
    this.worker = new MongoDbReaderWorker<TDto>({
      dtoCtor: this.dtoCtorWithIndex as unknown as any,
      mongoUri,
      mongoDb,
      validateReads: opts.validateReads ?? false,
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
    dtoCtor: DbReadDtoCtor<TDto>
  ): DbReadDtoCtorWithIndex<TDto> {
    const name = this.safeCtorName(dtoCtor);

    // Re-check the public surface too (defensive; prevents weird casts).
    if (!dtoCtor || typeof dtoCtor !== "object") {
      throw new Error(
        `DbReader(dtoCtor): expected an object ctor, got ${typeof dtoCtor} (dto=${name}).`
      );
    }
    if (typeof dtoCtor.fromBody !== "function") {
      throw new Error(
        `DbReader(dtoCtor): missing fromBody(j, opts) function (dto=${name}).`
      );
    }
    if (typeof dtoCtor.dbCollectionName !== "function") {
      throw new Error(
        `DbReader(dtoCtor): missing dbCollectionName() function (dto=${name}).`
      );
    }

    const anyCtor = dtoCtor as unknown as { indexHints?: unknown };
    const hints = anyCtor.indexHints;

    if (!Array.isArray(hints)) {
      // This is the important ADR-0106 guardrail: DB boundary requires index contract,
      // but handlers never type against it.
      throw new Error(
        `DbReader(dtoCtor): DTO is missing index contract (indexHints[]). ` +
          `Only DB DTOs are valid for persistence ops. (dto=${name}, collection=${dtoCtor.dbCollectionName()})`
      );
    }

    return dtoCtor as unknown as DbReadDtoCtorWithIndex<TDto>;
  }

  private safeCtorName(dtoCtor: DbReadDtoCtor<TDto>): string {
    // Best-effort; never throws.
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

  /** Read a single record by primary key; returns a bag (size 0 or 1). */
  public async readOneBagById(opts: { id: string }): Promise<DtoBag<TDto>> {
    await this.ensureIndexes();
    return this.worker.readOneBagById(opts);
  }

  /** Read the first record that matches a filter; returns a bag (size 0 or 1). */
  public async readOneBag(opts: {
    filter: Record<string, unknown>;
  }): Promise<DtoBag<TDto>> {
    await this.ensureIndexes();
    return this.worker.readOneBag(opts);
  }

  /** Read many by filter with a simple limit; returns a bag (0..N). */
  public async readManyBag(opts: {
    filter: Record<string, unknown>;
    limit?: number;
    order?: OrderSpec;
  }): Promise<DtoBag<TDto>> {
    await this.ensureIndexes();
    return this.worker.readManyBag(opts);
  }

  /** Batch read with keyset pagination; returns a bag + optional nextCursor. */
  public async readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>> {
    await this.ensureIndexes();

    const normalized: ReadBatchArgs = {
      ...args,
      order: args.order ?? ORDER_STABLE_ID_ASC,
    };
    return this.worker.readBatch(normalized);
  }
}
