// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric persistence
 * - ADRs:
 *   - ADR-0040/0041/0042/0043
 *   - ADR-0048 (Revised) — Writers accept **DtoBag** only
 *   - ADR-0053 (Bag Purity) — no naked DTOs cross boundaries
 *   - ADR-0054 (Idempotent Create via clone-on-duplicate, fixed retries)
 *
 * Purpose:
 * - Persist DTOs from a **DtoBag** using SvcEnvDto for connectivity.
 * - Create (write) and update are **singleton-bag** operations in current controllers.
 * - Batch insert supported via writeMany(bag) with per-item duplicate handling.
 *
 * Invariants:
 * - Canonical DTO id field is strictly "id" (string).
 * - Mongo/ObjectId conversion happens at the adapter edge only.
 * - Collection comes from each DTO instance via requireCollectionName().
 * - Duplicate key errors are normalized to DuplicateKeyError.
 * - On duplicate during **write() / writeMany()**, we call `dto.clone()` (which internally
 *   rebuilds via `DtoCtor.fromJson({...dto.toJson(), id:newUuid})`) and retry up to 3 times.
 *   Only the id can change; class and collection must remain identical — enforced below.
 */

import type { BaseDto } from "../DtoBase";
import type { SvcEnvDto } from "../svcenv.dto";
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
  // Canonical id is strictly "id"
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

/* ---------------------------------------------------------------------- */

export class DbWriter<TDto extends BaseDto> {
  private readonly _bag: DtoBag<TDto>;
  private readonly _svcEnv: SvcEnvDto;

  constructor(params: { bag: DtoBag<TDto>; svcEnv: SvcEnvDto }) {
    this._bag = params.bag;
    this._svcEnv = params.svcEnv;
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
   */
  public async write(): Promise<{ id: string }> {
    let dto = requireSingleton(this._bag, "write");
    let collectionName = (dto as BaseDto).requireCollectionName();
    let coll = await getExplicitCollection(this._svcEnv, collectionName);

    for (let attempt = 1; attempt <= MAX_DUP_RETRIES; attempt++) {
      try {
        const res = await coll.insertOne((dto as BaseDto).toJson() as any);
        const id = String(res?.insertedId ?? "");
        if (!id) {
          throw new Error(
            "DBWRITER_WRITE_NO_ID: insertOne returned no insertedId. " +
              "Ops: check write concerns and Mongo driver versions."
          );
        }
        return { id };
      } catch (err) {
        const dup = parseDuplicateKey(err);
        if (!dup) throw err;

        if (attempt < MAX_DUP_RETRIES) {
          if (typeof (dto as any).clone !== "function") {
            // clone contract missing; surface duplicate
            throw new DuplicateKeyError(dup, err as Error);
          }
          const cloned = (dto as any).clone() as BaseDto;
          assertCloneInvariants(dto as BaseDto, cloned as BaseDto);
          dto = cloned as TDto;

          // Collection should be identical; this is just a sanity no-op.
          const nextCollection = (dto as BaseDto).requireCollectionName();
          if (nextCollection !== collectionName) {
            collectionName = nextCollection; // should never happen given invariants
            coll = await getExplicitCollection(this._svcEnv, collectionName);
          }
          // retry loop continues
          continue;
        }

        // Exhausted retries
        throw new DuplicateKeyError(dup, err as Error);
      }
    }

    // Unreachable by design
    throw new Error(
      "DBWRITER_WRITE_EXHAUSTED: exhausted duplicate retries without success."
    );
  }

  /**
   * Batch insert: persists each DTO from the provided bag (parameter bag overrides instance bag).
   * For each item: on duplicate, clone() and retry up to MAX_DUP_RETRIES.
   * Returns ids in input order (ids may differ from input DTOs if clone() was used).
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
          const res = await coll.insertOne((dto as BaseDto).toJson() as any);
          const id = String(res?.insertedId ?? "");
          if (!id) {
            throw new Error(
              "DBWRITER_WRITE_MANY_NO_ID: insertOne returned no insertedId. " +
                "Ops: check write concerns and Mongo driver versions."
            );
          }
          ids.push(id);
          inserted = true;
        } catch (err) {
          const dup = parseDuplicateKey(err);
          if (!dup) throw err;

          if (attempt < MAX_DUP_RETRIES) {
            if (typeof (dto as any).clone !== "function") {
              throw new DuplicateKeyError(dup, err as Error);
            }
            const cloned = (dto as any).clone() as BaseDto;
            assertCloneInvariants(dto as BaseDto, cloned as BaseDto);
            dto = cloned as TDto;

            const nextCollection = (dto as BaseDto).requireCollectionName();
            if (nextCollection !== collectionName) {
              collectionName = nextCollection; // should never happen given invariants
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
      const res = await coll.updateOne({ _id: filter._id }, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        throw new Error(
          `DBWRITER_UPDATE_NO_MATCH: matched 0 documents for _id=${String(
            rawId
          )}. Ops: record may have been deleted; re-read before updating.`
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

export { DuplicateKeyError };
