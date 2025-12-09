// backend/services/shared/src/dto/persistence/dbReader/DbReader.mongoWorker.ts
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
 * - Mongo-backed implementation of IDbReaderWorker<TDto>.
 * - Encapsulates all direct Mongo connectivity and cursor logic.
 * - DbReader<TDto> delegates to this worker by default.
 */

import type { OrderSpec } from "@nv/shared/db/orderSpec";
import { ORDER_STABLE_ID_ASC, toMongoSort } from "@nv/shared/db/orderSpec";
import {
  encodeCursor,
  decodeCursor,
  keysetFromDoc,
  toMongoSeekFilter,
} from "@nv/shared/db/cursor";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { coerceForMongoQuery } from "../adapters/mongo/queryHelper";
import { MongoClient, Collection, Db, Document } from "mongodb";
import type {
  DbReaderOptions,
  IDbReaderWorker,
  ReadBatchArgs,
  ReadBatchResult,
} from "./DbReader";

/** Canonical wire id field for this codebase. */
const WIRE_ID_FIELD = "_id";

/* ----------------- minimal pooled client (per-process) ----------------- */

let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;
let _uriPinned: string | null = null;

type WireDoc = Document & { _id?: string };

async function getExplicitCollection<T extends Document = WireDoc>(
  mongoUri: string,
  mongoDbName: string,
  collectionName: string
): Promise<Collection<T>> {
  if (!mongoUri || !mongoDbName || !collectionName) {
    throw new Error(
      "DBREADER_MISCONFIG: mongoUri/mongoDb/collectionName required. " +
        "Ops: verify service bootstrap configuration; no defaults are permitted."
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
        `DBREADER_URI_MISMATCH: Previously pinned URI="${_uriPinned}", new URI="${mongoUri}". ` +
          "Ops: a single process must target one DB URI; restart with consistent configuration."
      );
    }
    if (_dbNamePinned !== mongoDbName) {
      throw new Error(
        `DBREADER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${mongoDbName}". ` +
          "Ops: a single process must target one DB; restart with consistent configuration."
      );
    }
  }

  return (_db as Db).collection<T>(collectionName);
}

/* ----------------- internal helpers ----------------- */

function ordersEqual(a: OrderSpec, b: OrderSpec): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].field !== b[i].field || a[i].dir !== b[i].dir) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------- */

export class MongoDbReaderWorker<TDto> implements IDbReaderWorker<TDto> {
  private readonly dtoCtor: DbReaderOptions<TDto>["dtoCtor"];
  private readonly mongoUri: string;
  private readonly mongoDb: string;
  private readonly validateReads: boolean;

  constructor(opts: DbReaderOptions<TDto>) {
    this.dtoCtor = opts.dtoCtor;
    this.mongoUri = opts.mongoUri;
    this.mongoDb = opts.mongoDb;
    this.validateReads = opts.validateReads ?? false;
  }

  /** Resolve collection from the DTO class. */
  private async collection(): Promise<Collection<WireDoc>> {
    const fn = this.dtoCtor.dbCollectionName;
    if (typeof fn !== "function") {
      throw new Error(
        `DBREADER_NO_COLLECTION_FN: DTO ${
          this.dtoCtor.name ?? "<anon>"
        } missing static dbCollectionName(). Dev: add it next to indexHints.`
      );
    }
    const collectionName = fn.call(this.dtoCtor);
    if (!collectionName?.trim()) {
      throw new Error(
        `DBREADER_EMPTY_COLLECTION: DTO ${
          this.dtoCtor.name ?? "<anon>"
        } returned empty dbCollectionName(). Dev: hard-wire a non-empty string.`
      );
    }
    return getExplicitCollection<WireDoc>(
      this.mongoUri,
      this.mongoDb,
      collectionName
    );
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const collectionName = this.dtoCtor.dbCollectionName();
    return { collectionName };
  }

  private hydrateDto(raw: WireDoc): TDto {
    // Raw Mongo doc → DTO via DTO.fromBody; DTO is responsible for handling `_id`.
    return this.dtoCtor.fromBody(raw, {
      validate: this.validateReads,
    });
  }

  /* ======================= BAG-CENTRIC READS ======================= */

  /** Read a single record by primary key; returns a bag (size 0 or 1). */
  public async readOneBagById(opts: { id: string }): Promise<DtoBag<TDto>> {
    const col = await this.collection();

    const dtoId = opts?.id;
    if (!dtoId || typeof dtoId !== "string" || !dtoId.trim()) {
      return new DtoBag<TDto>([]);
    }

    // UUIDv4 string primary key — query directly by `_id` as a string.
    const raw = await col.findOne({ [WIRE_ID_FIELD]: dtoId } as any);
    if (!raw) return new DtoBag<TDto>([]);
    const dto = this.hydrateDto(raw as WireDoc);
    return new DtoBag<TDto>([dto] as readonly TDto[]);
  }

  /** Read the first record that matches a filter; returns a bag (size 0 or 1). */
  public async readOneBag(opts: {
    filter: Record<string, unknown>;
  }): Promise<DtoBag<TDto>> {
    const col = await this.collection();
    const q = coerceForMongoQuery(opts?.filter ?? {}) as Record<
      string,
      unknown
    >;
    const raw = await col.findOne(q as any);
    if (!raw) return new DtoBag<TDto>([]);
    const dto = this.hydrateDto(raw as WireDoc);
    return new DtoBag<TDto>([dto] as readonly TDto[]);
  }

  /** Read many by filter with a simple limit; returns a bag (0..N). */
  public async readManyBag(opts: {
    filter: Record<string, unknown>;
    limit?: number;
    order?: OrderSpec;
  }): Promise<DtoBag<TDto>> {
    const col = await this.collection();
    const q = coerceForMongoQuery(opts?.filter ?? {}) as Record<
      string,
      unknown
    >;
    const limit =
      Number.isFinite(opts?.limit as number) && (opts!.limit as number) > 0
        ? (opts!.limit as number)
        : 100;
    const sort = toMongoSort(opts?.order ?? ORDER_STABLE_ID_ASC);
    const cur = col
      .find(q as any)
      .sort(sort)
      .limit(limit);
    const dtos: TDto[] = [];
    for await (const raw of cur) {
      dtos.push(this.hydrateDto(raw as WireDoc));
    }
    return new DtoBag<TDto>(dtos as readonly TDto[]);
  }

  /** Batch read with keyset pagination; returns a bag (0..N) plus optional nextCursor. */
  public async readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>> {
    const order = args.order ?? ORDER_STABLE_ID_ASC;
    const baseFilter = args.filter ?? {};
    const limit = args.limit;
    const rev = Boolean(args.rev);

    if (!Number.isFinite(limit) || limit! <= 0) {
      throw new Error(
        "DBREADER_INVALID_LIMIT: `limit` must be a positive integer. Ops: ensure handler enforces sane defaults."
      );
    }

    let seekFilter: Record<string, unknown> | undefined;
    if (args.cursor) {
      const { order: curOrder, last, rev: curRev } = decodeCursor(args.cursor);
      if (args.order && !ordersEqual(order, curOrder)) {
        throw new Error(
          "DBREADER_ORDER_MISMATCH: Cursor order differs from requested order."
        );
      }
      seekFilter = toMongoSeekFilter(curOrder, last, curRev ?? false);
    }

    const rawFilter = seekFilter
      ? { $and: [baseFilter, seekFilter] }
      : baseFilter;
    const filter = coerceForMongoQuery(rawFilter) as Record<string, unknown>;
    const col = await this.collection();

    const fetchN = limit + 1;
    const docs: WireDoc[] =
      (await col
        .find(filter as any)
        .sort(toMongoSort(order))
        .limit(fetchN)
        .toArray?.()) ??
      (await (async () => {
        const arr: WireDoc[] = [];
        const cursor = col
          .find(filter as any)
          .sort(toMongoSort(order))
          .limit(fetchN);
        for await (const raw of cursor) arr.push(raw as WireDoc);
        return arr;
      })());

    const slice = docs.slice(0, limit);
    const dtos = slice.map((raw) => this.hydrateDto(raw));
    const bag = new DtoBag<TDto>(dtos as readonly TDto[]);

    let nextCursor: string | undefined;
    if (docs.length > limit && slice.length > 0) {
      const lastDocRaw = docs[slice.length - 1];
      const lastKeyset = keysetFromDoc(lastDocRaw, order);
      nextCursor = encodeCursor({ order, last: lastKeyset, rev });
    }

    return { bag, nextCursor };
  }
}
