// backend/services/shared/src/dto/persistence/dbWriter/DbWriter.mongoWorker.ts
/**
 * Docs:
 * - ADR-0040/41/42/43 (DTO-first, handlers, context bus, failure propagation)
 * - ADR-0045 (Index Hints ensured at boot)
 * - ADR-0048 (Writers accept DtoBag only)
 * - ADR-0053 (Bag Purity — return DTOs, not wire)
 * - ADR-0057 (IDs are UUIDv4; assign BEFORE toBody; immutable thereafter)
 *
 * Purpose:
 * - Mongo-backed implementation of IDbWriterWorker<TDto>.
 * - Encapsulates all direct Mongo connectivity and duplicate handling.
 *
 * Critical invariant (ADR-0057):
 * - This worker MUST NOT mint ids and MUST NOT "heal" `_id` conflicts by cloning.
 * - Missing id is an upstream error; duplicate `_id` is a 409 conflict.
 */

import { MongoClient, Collection, Db } from "mongodb";
import type { DtoBase } from "../../DtoBase";
import type { ILogger } from "../../../logger/Logger";
import { DtoBag } from "../../../dto/DtoBag";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "../adapters/mongo/dupeKeyError";
import type { IDbWriterWorker } from "./DbWriter";

/* ----------------- minimal pooled client (per-process) ----------------- */

let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;
let _uriPinned: string | null = null;

/** internal: tiny console-backed logger if none is provided */
export function consoleLogger(ctx: Record<string, unknown> = {}): ILogger {
  const wrap =
    (level: "debug" | "info" | "warn" | "error") =>
    (meta?: unknown, msg?: string) => {
      const payload =
        meta && typeof meta === "object"
          ? { ...ctx, ...(meta as Record<string, unknown>) }
          : { ...ctx, meta };
      // eslint-disable-next-line no-console
      console[level](
        `[DbWriter] ${msg ?? ""}`.trim(),
        Object.keys(payload).length ? payload : undefined
      );
    };
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    child(_b: any) {
      return consoleLogger({ ...ctx, ...(_b ?? {}) });
    },
  } as unknown as ILogger;
}

async function getExplicitCollection(
  mongoUri: string,
  mongoDbName: string,
  collectionName: string
): Promise<Collection> {
  if (!mongoUri || !mongoDbName || !collectionName) {
    throw new Error(
      "DBWRITER_MISCONFIG: mongoUri/mongoDb/collectionName required. " +
        "Ops: verify env-service configuration for this service; no defaults permitted."
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
        `DBWRITER_URI_MISMATCH: Previously pinned URI="${_uriPinned}", new URI="${mongoUri}".`
      );
    }
    if (_dbNamePinned !== mongoDbName) {
      throw new Error(
        `DBWRITER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${mongoDbName}".`
      );
    }
  }

  return (_db as Db).collection(collectionName);
}

/* ----------------------- helpers ----------------------------- */

function requireSingleton<TDto extends DtoBase>(
  bag: DtoBag<TDto>,
  op: "write" | "update"
): TDto {
  const items = Array.from(bag.items());
  if (items.length !== 1) {
    const msg =
      items.length === 0
        ? `${op}: singleton bag required; received 0 items`
        : `${op}: singleton bag required; received ${items.length} items`;
    throw new Error(`DBWRITER_SINGLETON_REQUIRED: ${msg}`);
  }
  return items[0] as TDto;
}

/** Heuristic: does a parsed duplicate refer to the _id key/index? */
function isIdDuplicate(dup: any): boolean {
  if (!dup) return false;
  const key = String(dup.key ?? "").toLowerCase();
  const index = String(dup.index ?? "").toLowerCase();
  if (key === "_id" || index === "_id_") return true;
  if (dup.fields && typeof dup.fields === "object" && "_id" in dup.fields)
    return true;
  return false;
}

function requireId(
  base: DtoBase,
  op: "write" | "writeMany" | "update"
): string {
  const id = String(base.getId() ?? "").trim();
  if (!id) {
    throw new Error(
      `DBWRITER_ID_REQUIRED: ${op} requires canonical id to be assigned upstream (ADR-0057).`
    );
  }
  return id;
}

/* ---------------------- worker class ------------------------- */

export class MongoDbWriterWorker<TDto extends DtoBase>
  implements IDbWriterWorker<TDto>
{
  private readonly bag: DtoBag<TDto>;
  private readonly mongoUri: string;
  private readonly mongoDb: string;
  private readonly userId?: string;
  private readonly log: ILogger;

  constructor(params: {
    bag: DtoBag<TDto>;
    mongoUri: string;
    mongoDb: string;
    log: ILogger;
    userId?: string;
  }) {
    this.bag = params.bag;
    this.mongoUri = params.mongoUri;
    this.mongoDb = params.mongoDb;
    this.userId = params.userId;
    this.log = params.log;
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const dto = requireSingleton(this.bag, "write");
    const collectionName = (dto as DtoBase).requireCollectionName();
    return { collectionName };
  }

  /**
   * Insert a single DTO from the singleton bag.
   * Assign meta BEFORE toBody. Id must already exist; no minting here.
   */
  public async write(): Promise<DtoBag<TDto>> {
    const dto = requireSingleton(this.bag, "write");
    const base = dto as DtoBase;

    // strict: must already exist
    requireId(base, "write");

    const collectionName = base.requireCollectionName();
    const coll = await getExplicitCollection(
      this.mongoUri,
      this.mongoDb,
      collectionName
    );

    try {
      base.stampCreatedAt();
      base.stampOwnerUserId(this.userId);
      base.stampUpdatedAt(this.userId);

      const json = base.toBody() as Record<string, unknown>;
      const wireId = String((json as any)._id ?? "").trim();
      if (!wireId) {
        throw new Error(
          "DBWRITER_WRITE_NO_WIRE_ID: toBody() did not include `_id`."
        );
      }

      const res = await coll.insertOne(json as any);
      const insertedId = String(res?.insertedId ?? "");
      if (!insertedId) {
        throw new Error(
          "DBWRITER_WRITE_NO_ID: insertOne returned no insertedId."
        );
      }

      return new DtoBag<TDto>([dto as TDto]);
    } catch (err) {
      const dup = parseDuplicateKey(err);
      if (!dup) {
        this.log.error(
          { collection: collectionName, err: (err as Error)?.message },
          "dbwriter: insert failed (non-duplicate)"
        );
        throw err;
      }

      const idDup = isIdDuplicate(dup);

      this.log.warn(
        {
          collection: collectionName,
          code: 11000,
          detail: dup,
          idDuplicate: idDup,
        },
        "dbwriter: duplicate key"
      );

      // IMPORTANT: no clone-retry for _id. Duplicate is a real 409 conflict now.
      throw new DuplicateKeyError(dup, err as Error);
    }
  }

  /**
   * Batch insert.
   * Stamps meta only. Id must already exist on every DTO; no minting, no retry cloning.
   */
  public async writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>> {
    const source = bag ?? this.bag;
    const inserted: TDto[] = [];

    for (const _item of source.items()) {
      const dto = _item as TDto;
      const base = dto as DtoBase;

      requireId(base, "writeMany");

      const collectionName = base.requireCollectionName();
      const coll = await getExplicitCollection(
        this.mongoUri,
        this.mongoDb,
        collectionName
      );

      try {
        base.stampCreatedAt();
        base.stampOwnerUserId(this.userId);
        base.stampUpdatedAt(this.userId);

        const json = base.toBody() as Record<string, unknown>;
        const wireId = String((json as any)._id ?? "").trim();
        if (!wireId) {
          throw new Error(
            "DBWRITER_WRITE_MANY_NO_WIRE_ID: toBody() did not include `_id`."
          );
        }

        const res = await coll.insertOne(json as any);
        const insertedId = String(res?.insertedId ?? "");
        if (!insertedId) {
          throw new Error(
            "DBWRITER_WRITE_MANY_NO_ID: insertOne returned no insertedId."
          );
        }

        inserted.push(dto);
      } catch (err) {
        const dup = parseDuplicateKey(err);
        if (!dup) {
          this.log.error(
            { collection: collectionName, err: (err as Error)?.message },
            "dbwriter: insert failed (many, non-duplicate)"
          );
          throw err;
        }

        const idDup = isIdDuplicate(dup);
        this.log.warn(
          {
            collection: collectionName,
            code: 11000,
            detail: dup,
            idDuplicate: idDup,
          },
          "dbwriter: duplicate key (many)"
        );

        // No per-item clone retry; surface as 409
        throw new DuplicateKeyError(dup, err as Error);
      }
    }

    return new DtoBag<TDto>(inserted);
  }

  /** Update by canonical id (no id mutation). */
  public async update(): Promise<{ id: string }> {
    const dto = requireSingleton(this.bag, "update");
    const base = dto as DtoBase;

    const rawId = requireId(base, "update");

    const collectionName = base.requireCollectionName();
    const coll = await getExplicitCollection(
      this.mongoUri,
      this.mongoDb,
      collectionName
    );

    // Refresh update meta only; createdAt/ownerUserId stay as-is.
    base.stampUpdatedAt(this.userId);

    const json = base.toBody() as Record<string, unknown>;
    const { _id, id: _wireId, ...rest } = json as Record<string, unknown>;

    const filter = { _id: String(rawId) };

    try {
      const res = await coll.updateOne(filter as any, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        throw new Error(
          `DBWRITER_UPDATE_NO_MATCH: matched 0 documents for _id=${String(
            rawId
          )}`
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

export { DuplicateKeyError } from "../adapters/mongo/dupeKeyError";
