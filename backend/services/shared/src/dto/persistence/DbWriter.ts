// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric persistence
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (Revised) — Writers accept **DtoBag** only
 *   - ADR-0053 (Bag Purity) — no naked DTOs cross boundaries
 *   - ADR-0054 (Idempotent Create via clone-on-duplicate, fixed retries)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Persist DTOs from a **DtoBag** using SvcEnvDto for connectivity.
 * - Create (write) and update are **singleton-bag** operations in current controllers.
 * - Batch insert supported via writeMany(bag) with per-item duplicate handling.
 *
 * Invariants:
 * - Canonical **wire** id field is strictly "id" (string).
 * - Mongo enforces uniqueness on **_id** ONLY (single unique key).
 * - Adapter maps "id" → "_id:ObjectId" **exactly once** before insert; wire never leaks "_id".
 * - Collection comes from each DTO instance via requireCollectionName().
 * - Duplicate key errors are normalized to DuplicateKeyError.
 * - On duplicate during **write() / writeMany()**, we call `dto.clone()` (which internally
 *   rebuilds via `DtoCtor.fromJson({...dto.toJson(), id:newUuid})`) and retry up to 3 times.
 *   Only the id can change; class and collection must remain identical — enforced below.
 */

import type { BaseDto } from "../DtoBase";
import type { SvcEnvDto } from "../svcenv.dto";
import type { ILogger } from "../../logger/Logger";
import { MongoClient, Collection, Db, ObjectId } from "mongodb";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "./adapters/mongo/dupeKeyError";
import { coerceForMongoQuery } from "./adapters/mongo/queryHelper";

/* ----------------- minimal pooled client (per-process) ----------------- */
let _client: MongoClient | null = null;
let _db: Db | null = null;
let _dbNamePinned: string | null = null;

/** internal: tiny console-backed logger if none is provided */
function consoleLogger(ctx: Record<string, unknown> = {}): ILogger {
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
  svcEnv: SvcEnvDto,
  collectionName: string
): Promise<Collection> {
  const uri = svcEnv.getEnvVar("NV_MONGO_URI");
  const dbName = svcEnv.getEnvVar("NV_MONGO_DB");

  if (!uri || !dbName || !collectionName) {
    throw new Error(
      "DBWRITER_MISCONFIG: NV_MONGO_URI/NV_MONGO_DB/collectionName required. " +
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
      `DBWRITER_DB_MISMATCH: Previously pinned DB="${_dbNamePinned}", new DB="${dbName}". ` +
        "Ops: a single process must target one DB; restart with consistent env."
    );
  }

  return (_db as Db).collection(collectionName);
}

/* ----------------------- helpers ----------------------------- */

const MAX_DUP_RETRIES = 3;

function requireSingleton<TDto extends BaseDto>(
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

function resolveDtoStringId(
  dto: BaseDto,
  json: Record<string, unknown>
): string {
  // Canonical wire id is strictly "id"
  const fromDto = (dto as any).id;
  if (typeof fromDto === "string" && fromDto.trim() !== "")
    return fromDto.trim();

  const fromJson = json["id"];
  if (typeof fromJson === "string" && (fromJson as string).trim() !== "")
    return String(fromJson).trim();

  throw new Error(
    "DBWRITER_MISSING_ID: DTO lacks canonical 'id' (string). " +
      "Ops: ensure DTO exposes .id and that patch/create set it before persistence."
  );
}

/** Enforce clone invariants: same class, same collection; only id may differ. */
function assertCloneInvariants(before: BaseDto, after: BaseDto): void {
  const beforeCtor = (before as any)?.constructor;
  const afterCtor = (after as any)?.constructor;
  if (beforeCtor !== afterCtor) {
    throw new Error(
      "DBWRITER_CLONE_INVARIANT: clone() changed DTO class. " +
        "Dev: clone must preserve type; only 'id' may change."
    );
  }
  const beforeColl = before.requireCollectionName();
  const afterColl = after.requireCollectionName();
  if (beforeColl !== afterColl) {
    throw new Error(
      `DBWRITER_CLONE_INVARIANT: clone() changed dbCollectionName() from "${beforeColl}" to "${afterColl}". ` +
        "Dev: collection identity must be immutable."
    );
  }
}

/**
 * Map wire id → Mongo _id:ObjectId exactly once.
 * - Requires a non-empty string `id` on the input.
 * - Produces a doc with `_id:ObjectId(id)` and removes `id`.
 * - Never persists both `id` and `_id`.
 */
function mapWireIdToMongoDoc(json: Record<string, unknown>): {
  doc: Record<string, unknown>;
  usedId: string;
} {
  const id = json["id"];
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(
      "DBWRITER_ID_MAPPING: missing id before insert. " +
        "Dev: ensure DTO carries a valid 'id' (string) prior to persistence."
    );
  }

  const objectId = new ObjectId(id); // adapter defines DB identity strictly as ObjectId(id)
  const doc: Record<string, unknown> = { ...json, _id: objectId };
  delete (doc as any).id;

  return { doc, usedId: id };
}

/* ---------------------------------------------------------------------- */

export class DbWriter<TDto extends BaseDto> {
  private readonly _bag: DtoBag<TDto>;
  private readonly _svcEnv: SvcEnvDto;
  private readonly log: ILogger;

  constructor(params: { bag: DtoBag<TDto>; svcEnv: SvcEnvDto; log?: ILogger }) {
    this._bag = params.bag;
    this._svcEnv = params.svcEnv;
    // prefer provided logger; fall back to a console-backed shim
    this.log = params.log ?? consoleLogger({ component: "DbWriter" });
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const dto = requireSingleton(this._bag, "write");
    const collectionName = (dto as BaseDto).requireCollectionName();
    return { collectionName };
  }

  /**
   * Insert a single DTO from the singleton bag.
   * On duplicate: call dto.clone() (new UUID id) and retry up to MAX_DUP_RETRIES.
   * Instrumentation:
   *  - DEBUG before insert with collection and id/_id
   *  - DEBUG after insert with insertedId
   *  - WARN on duplicate, ERROR on unexpected failure
   */
  public async write(): Promise<{ id: string }> {
    let dto = requireSingleton(this._bag, "write");
    let collectionName = (dto as BaseDto).requireCollectionName();
    let coll = await getExplicitCollection(this._svcEnv, collectionName);

    for (let attempt = 1; attempt <= MAX_DUP_RETRIES; attempt++) {
      try {
        const json = (dto as BaseDto).toJson() as Record<string, unknown>;
        const mapped = mapWireIdToMongoDoc(json);

        this.log.debug(
          {
            op: "insertOne",
            attempt,
            collection: collectionName,
            willInsert: { _id: String((mapped.doc as any)?._id) },
          },
          "dbwriter: about to insert"
        );

        const res = await coll.insertOne(mapped.doc as any);

        const insertedId = String(res?.insertedId ?? "");
        if (!insertedId) {
          const msg =
            "DBWRITER_WRITE_NO_ID: insertOne returned no insertedId. " +
            "Ops: check write concerns and Mongo driver versions.";
          this.log.error({ collection: collectionName }, msg);
          throw new Error(msg);
        }

        this.log.debug(
          {
            op: "insertOne",
            attempt,
            collection: collectionName,
            insertedId,
          },
          "dbwriter: insert complete"
        );

        // Return the canonical wire id (same string we derived ObjectId from)
        return { id: mapped.usedId };
      } catch (err) {
        const dup = parseDuplicateKey(err);
        if (!dup) {
          this.log.error(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              err: (err as Error)?.message,
            },
            "dbwriter: insert failed (non-duplicate)"
          );
          throw err; // bubble with context already logged
        }

        // Duplicate
        this.log.warn(
          {
            op: "insertOne",
            attempt,
            collection: collectionName,
            code: 11000,
            detail: dup,
          },
          "dbwriter: duplicate key"
        );

        if (attempt < MAX_DUP_RETRIES) {
          if (typeof (dto as any).clone !== "function") {
            this.log.warn(
              { collection: collectionName },
              "dbwriter: clone() not available; surfacing duplicate"
            );
            throw new DuplicateKeyError(dup, err as Error);
          }
          const cloned = (dto as any).clone() as BaseDto;
          assertCloneInvariants(dto as BaseDto, cloned as BaseDto);
          dto = cloned as TDto;

          // Sanity (collection should remain identical)
          const nextCollection = (dto as BaseDto).requireCollectionName();
          if (nextCollection !== collectionName) {
            this.log.warn(
              {
                from: collectionName,
                to: nextCollection,
              },
              "dbwriter: collection changed across clone (unexpected)"
            );
            collectionName = nextCollection;
            coll = await getExplicitCollection(this._svcEnv, collectionName);
          }

          continue; // retry
        }

        // Exhausted retries — bubble normalized duplicate
        throw new DuplicateKeyError(dup, err as Error);
      }
    }

    // Unreachable by design
    const msg =
      "DBWRITER_WRITE_EXHAUSTED: exhausted duplicate retries without success.";
    this.log.error({ msg }, "dbwriter: exhausted retries");
    throw new Error(msg);
  }

  /**
   * Batch insert: persists each DTO from the provided bag (parameter bag overrides instance bag).
   * For each item: on duplicate, clone() and retry up to MAX_DUP_RETRIES.
   * Returns ids in input order (ids may differ from input DTOs if clone() was used).
   * Instrumentation mirrors write(): DEBUG before/after, WARN on duplicate, ERROR otherwise.
   */
  public async writeMany(bag?: DtoBag<TDto>): Promise<{ ids: string[] }> {
    const source = bag ?? this._bag;
    const ids: string[] = [];

    for (const _item of source.items()) {
      let dto = _item as TDto;
      let collectionName = (dto as BaseDto).requireCollectionName();
      let coll = await getExplicitCollection(this._svcEnv, collectionName);

      let inserted = false;
      for (
        let attempt = 1;
        attempt <= MAX_DUP_RETRIES && !inserted;
        attempt++
      ) {
        try {
          const json = (dto as BaseDto).toJson() as Record<string, unknown>;
          const mapped = mapWireIdToMongoDoc(json);

          this.log.debug(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              willInsert: { _id: String((mapped.doc as any)?._id) },
            },
            "dbwriter: about to insert (many)"
          );

          const res = await coll.insertOne(mapped.doc as any);
          const insertedId = String(res?.insertedId ?? "");
          if (!insertedId) {
            const msg =
              "DBWRITER_WRITE_MANY_NO_ID: insertOne returned no insertedId. " +
              "Ops: check write concerns and Mongo driver versions.";
            this.log.error({ collection: collectionName }, msg);
            throw new Error(msg);
          }

          this.log.debug(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              insertedId,
            },
            "dbwriter: insert complete (many)"
          );

          ids.push(mapped.usedId);
          inserted = true;
        } catch (err) {
          const dup = parseDuplicateKey(err);
          if (!dup) {
            this.log.error(
              {
                op: "insertOne",
                attempt,
                collection: collectionName,
                err: (err as Error)?.message,
              },
              "dbwriter: insert failed (many, non-duplicate)"
            );
            throw err;
          }

          this.log.warn(
            {
              op: "insertOne",
              attempt,
              collection: collectionName,
              code: 11000,
              detail: dup,
            },
            "dbwriter: duplicate key (many)"
          );

          if (attempt < MAX_DUP_RETRIES) {
            if (typeof (dto as any).clone !== "function") {
              this.log.warn(
                { collection: collectionName },
                "dbwriter: clone() not available (many); surfacing duplicate"
              );
              throw new DuplicateKeyError(dup, err as Error);
            }
            const cloned = (dto as any).clone() as BaseDto;
            assertCloneInvariants(dto as BaseDto, cloned as BaseDto);
            dto = cloned as TDto;

            const nextCollection = (dto as BaseDto).requireCollectionName();
            if (nextCollection !== collectionName) {
              this.log.warn(
                { from: collectionName, to: nextCollection },
                "dbwriter: collection changed across clone (many, unexpected)"
              );
              collectionName = nextCollection;
              coll = await getExplicitCollection(this._svcEnv, collectionName);
            }
            continue;
          }

          throw new DuplicateKeyError(dup, err as Error);
        }
      }
    }

    return { ids };
  }

  /**
   * Update the single DTO from the singleton bag by its canonical id.
   * Uses $set of dto.toJson() (excluding _id).
   * Returns { id } on success; throws if 0 matches.
   */
  public async update(): Promise<{ id: string }> {
    const dto = requireSingleton(this._bag, "update");
    const collectionName = (dto as BaseDto).requireCollectionName();
    const coll = await getExplicitCollection(this._svcEnv, collectionName);

    const json = (dto as BaseDto).toJson() as Record<string, unknown>;
    const rawId = resolveDtoStringId(dto as BaseDto, json);

    const { _id, ...rest } = json;

    const filter = coerceForMongoQuery({ _id: String(rawId) }) as {
      _id: ObjectId;
    };

    try {
      this.log.debug(
        { op: "updateOne", collection: collectionName, _id: String(rawId) },
        "dbwriter: about to update"
      );

      const res = await coll.updateOne({ _id: filter._id }, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        const msg = `DBWRITER_UPDATE_NO_MATCH: matched 0 documents for _id=${String(
          rawId
        )}. Ops: record may have been deleted; re-read before updating.`;
        this.log.warn({ collection: collectionName, _id: String(rawId) }, msg);
        throw new Error(msg);
      }

      this.log.debug(
        { op: "updateOne", collection: collectionName, _id: String(rawId) },
        "dbwriter: update complete"
      );

      return { id: String(rawId) };
    } catch (err) {
      const dup = parseDuplicateKey(err);
      if (dup) {
        this.log.warn(
          {
            op: "updateOne",
            collection: collectionName,
            _id: String(rawId),
            code: 11000,
            detail: dup,
          },
          "dbwriter: duplicate key on update"
        );
        throw new DuplicateKeyError(dup, err as Error);
      }
      this.log.error(
        {
          op: "updateOne",
          collection: collectionName,
          _id: String(rawId),
          err: (err as Error)?.message,
        },
        "dbwriter: update failed"
      );
      throw err;
    }
  }
}

export { DuplicateKeyError };
