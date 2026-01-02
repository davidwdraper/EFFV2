// backend/services/shared/src/dto/persistence/dbReader/DbReader.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; reads hydrate DTOs with validate=false by default
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (Revised) — All reads return DtoBag (singleton or empty)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *
 * Purpose:
 * - Public DbReader<TDto> facade used by handlers.
 * - Exposes the original API while delegating to an IDbReaderWorker<TDto>.
 * - Default worker is MongoDbReaderWorker<TDto>, preserving existing behavior.
 * - Future Db-mock / full-mock workers can be injected via the optional
 *   `worker` parameter without changing handler call sites.
 *
 * Invariants:
 * - Wire primary key is `_id` (string); DTO internals store the same value via DtoBase.
 * - Service code treats ids as opaque strings at the edges.
 * - No implicit fallbacks; Dev == Prod. Missing config → fail fast.
 */

import type { OrderSpec } from "../../../db/orderSpec";
import { ORDER_STABLE_ID_ASC } from "../../../db/orderSpec";
import { DtoBag } from "../../../dto/DtoBag";
import { MongoDbReaderWorker } from "./DbReader.mongoWorker";

type DtoCtorWithCollection<T> = {
  fromBody: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string; // hard-wired per DTO near indexHints
  name?: string;
};

export type DbReaderOptions<T> = {
  dtoCtor: DtoCtorWithCollection<T>;
  mongoUri: string;
  mongoDb: string;
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
 * - Keeps the original constructor surface and methods.
 * - Delegates all behavior to an injected IDbReaderWorker<TDto>.
 * - Uses MongoDbReaderWorker<TDto> by default (non-mock path).
 */
export class DbReader<TDto> {
  private readonly worker: IDbReaderWorker<TDto>;

  constructor(
    opts: DbReaderOptions<TDto> & { worker?: IDbReaderWorker<TDto> }
  ) {
    this.worker =
      opts.worker ??
      new MongoDbReaderWorker<TDto>({
        dtoCtor: opts.dtoCtor,
        mongoUri: opts.mongoUri,
        mongoDb: opts.mongoDb,
        validateReads: opts.validateReads ?? false,
      });
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    return this.worker.targetInfo();
  }

  /** Read a single record by primary key; returns a bag (size 0 or 1). */
  public async readOneBagById(opts: { id: string }): Promise<DtoBag<TDto>> {
    return this.worker.readOneBagById(opts);
  }

  /** Read the first record that matches a filter; returns a bag (size 0 or 1). */
  public async readOneBag(opts: {
    filter: Record<string, unknown>;
  }): Promise<DtoBag<TDto>> {
    return this.worker.readOneBag(opts);
  }

  /** Read many by filter with a simple limit; returns a bag (0..N). */
  public async readManyBag(opts: {
    filter: Record<string, unknown>;
    limit?: number;
    order?: OrderSpec;
  }): Promise<DtoBag<TDto>> {
    return this.worker.readManyBag(opts);
  }

  /** Batch read with keyset pagination; returns a bag + optional nextCursor. */
  public async readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>> {
    // Preserve old default order behavior here for compatibility.
    const normalized: ReadBatchArgs = {
      ...args,
      order: args.order ?? ORDER_STABLE_ID_ASC,
    };
    return this.worker.readBatch(normalized);
  }
}
