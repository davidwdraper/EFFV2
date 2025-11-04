// backend/services/shared/src/dto/persistence/DbReader.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; reads hydrate DTOs with validate=false by default
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *
 * Purpose:
 * - Read one/many records from Mongo and hydrate DTOs.
 * - Collection name is resolved from the DTO CLASS via dbCollectionName() (hard-wired per DTO, DB-agnostic).
 * - After hydration, seed the instance with setCollectionName(...) for parity with writers.
 *
 * Invariants:
 * - Service code only deals in **DTO ids (string)**.
 * - Mongo/ObjectId conversion occurs **at the last possible moment** inside this class.
 * - No implicit fallbacks; Dev == Prod. Missing config → fail fast.
 */

import type { SvcEnvDto } from "../svcenv.dto";
import { mongoNormalizeToDto } from "./adapters/mongo/mongoNormalizeToDto";

import type { OrderSpec } from "@nv/shared/db/orderSpec";
import { ORDER_STABLE_ID_ASC, toMongoSort } from "@nv/shared/db/orderSpec";
import {
  encodeCursor,
  decodeCursor,
  keysetFromDoc,
  toMongoSeekFilter,
} from "@nv/shared/db/cursor";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { coerceForMongoQuery } from "./adapters/mongo/queryHelper";
import { MongoClient, Collection, Db, ObjectId } from "mongodb";

type DtoCtorWithCollection<T> = {
  fromJson: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string; // hard-wired per DTO near indexHints
  name?: string;
};

type DbReaderOptions<T> = {
  dtoCtor: DtoCtorWithCollection<T>;
  svcEnv: SvcEnvDto;
  validateReads?: boolean; // default false
  /** Literal template default; cloners override via handler if desired. */
  idFieldName?: string; // default: "xxxId"
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
      "DBREADER_MISCONFIG: NV_MONGO_URI/NV_MONGO_DB/collectionName required. " +
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
      `DBREADER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${dbName}". ` +
        "Ops: a single process must target one DB; restart with consistent env."
    );
  }

  return (_db as Db).collection(collectionName);
}

/* ---------------------------------------------------------------------- */

export class DbReader<TDto> {
  private readonly dtoCtor: DtoCtorWithCollection<TDto>;
  private readonly svcEnv: SvcEnvDto;
  private readonly validateReads: boolean;
  private readonly idFieldName: string;

  constructor(opts: DbReaderOptions<TDto>) {
    this.dtoCtor = opts.dtoCtor;
    this.svcEnv = opts.svcEnv;
    this.validateReads = opts.validateReads ?? false;
    this.idFieldName = opts.idFieldName ?? "xxxId";
  }

  /** Resolve collection from the DTO class. */
  private async collection(): Promise<Collection> {
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
    return getExplicitCollection(this.svcEnv, collectionName);
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const collectionName = this.dtoCtor.dbCollectionName();
    return { collectionName };
  }

  private _seedCollectionOn(dto: TDto): void {
    const anyDto = dto as unknown as {
      setCollectionName?: (n: string) => unknown;
    };
    if (typeof anyDto?.setCollectionName === "function") {
      anyDto.setCollectionName(this.dtoCtor.dbCollectionName());
    }
  }

  public async readById(dtoId: string): Promise<TDto | undefined> {
    const col = await this.collection();

    if (!dtoId || typeof dtoId !== "string" || !dtoId.trim()) {
      return undefined;
    }

    let oid: ObjectId | null = null;
    try {
      const q = coerceForMongoQuery({ _id: dtoId }) as { _id: ObjectId };
      oid = q._id;
    } catch {
      return undefined;
    }

    const raw = await col.findOne({ _id: oid });
    if (!raw) return undefined;

    const dtoJson = mongoNormalizeToDto(raw, this.idFieldName);
    const dto = this.dtoCtor.fromJson(dtoJson, {
      validate: this.validateReads,
    });
    this._seedCollectionOn(dto);
    return dto;
  }

  public async readOne(
    filter: Record<string, unknown>
  ): Promise<TDto | undefined> {
    const col = await this.collection();
    const q = coerceForMongoQuery(filter) as Record<string, unknown>;
    const raw = await col.findOne(q);
    if (!raw) return undefined;
    const dtoJson = mongoNormalizeToDto(raw, this.idFieldName);
    const dto = this.dtoCtor.fromJson(dtoJson, {
      validate: this.validateReads,
    });
    this._seedCollectionOn(dto);
    return dto;
  }

  public async readMany(
    filter: Record<string, unknown>,
    limit = 100
  ): Promise<TDto[]> {
    const col = await this.collection();
    const q = coerceForMongoQuery(filter) as Record<string, unknown>;
    const cur = col.find(q).limit(limit);
    const out: TDto[] = [];
    for await (const raw of cur) {
      const dtoJson = mongoNormalizeToDto(raw, this.idFieldName);
      const dto = this.dtoCtor.fromJson(dtoJson, {
        validate: this.validateReads,
      });
      this._seedCollectionOn(dto);
      out.push(dto);
    }
    return out;
  }

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
    const docs: any[] =
      (await col
        .find(filter)
        .sort(toMongoSort(order))
        .limit(fetchN)
        .toArray?.()) ??
      (await (async () => {
        const arr: any[] = [];
        const cursor = col.find(filter).sort(toMongoSort(order)).limit(fetchN);
        for await (const raw of cursor) arr.push(raw);
        return arr;
      })());

    const slice = docs.slice(0, limit);
    const dtos = slice.map((raw) => {
      const dto = this.dtoCtor.fromJson(
        mongoNormalizeToDto(raw, this.idFieldName),
        { validate: this.validateReads }
      );
      this._seedCollectionOn(dto);
      return dto;
    });
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

/* ----------------- internal helpers ----------------- */

function ordersEqual(a: OrderSpec, b: OrderSpec): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].field !== b[i].field || a[i].dir !== b[i].dir) return false;
  }
  return true;
}
