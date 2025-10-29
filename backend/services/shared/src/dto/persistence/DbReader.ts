// backend/services/shared/src/dto/persistence/DbReader.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; reads hydrate DTOs with validate=false by default
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *
 * Purpose:
 * - Read one/many records from Mongo and hydrate DTOs.
 * - Env-driven collection resolution (NV_MONGO_URI / NV_MONGO_DB / NV_MONGO_COLLECTION).
 * - Normalizes Mongo-native shapes (e.g., _id:ObjectId) before DTO.fromJson().
 * - Adds deterministic keyset pagination (cursor-based) for batched reads.
 *
 * Invariants:
 * - Database performs sorting; we enforce a stable order contract and build seek filters.
 * - Order must be deterministic with `_id` as the final tie-breaker.
 * - No env fallbacks here; collection is resolved via SvcEnvDto only.
 */

import type { SvcEnvDto } from "../svcenv.dto";
import { getMongoCollectionFromSvcEnv } from "./adapters/mongo/connectFromSvcEnv";
import { mongoNormalizeId } from "./adapters/mongo/mongoNormalizeId";
import { ObjectId } from "mongodb";

import type { OrderSpec } from "@nv/shared/db/orderSpec";
import { ORDER_STABLE_ID_ASC, toMongoSort } from "@nv/shared/db/orderSpec";
import {
  encodeCursor,
  decodeCursor,
  keysetFromDoc,
  toMongoSeekFilter,
} from "@nv/shared/db/cursor";
import { DtoBag } from "@nv/shared/dto/DtoBag";

type Ctor<T> = {
  fromJson: (j: unknown, opts?: { validate?: boolean }) => T;
};

type DbReaderOptions<T> = {
  dtoCtor: Ctor<T>;
  svcEnv: SvcEnvDto;
  validateReads?: boolean; // default false (trust our own writes)
};

/** Batch read args/result (cursor-based keyset pagination). */
export type ReadBatchArgs = {
  filter?: Record<string, unknown>;
  order?: OrderSpec; // default: ORDER_STABLE_ID_ASC
  limit: number; // required; positive integer
  cursor?: string | null; // opaque base64 JSON { order, last, rev }
  rev?: boolean; // when true, read "previous" direction
};

export type ReadBatchResult<TDto> = {
  bag: DtoBag<TDto>;
  nextCursor?: string; // undefined when no further page
};

export class DbReader<TDto> {
  private readonly dtoCtor: Ctor<TDto>;
  private readonly svcEnv: SvcEnvDto;
  private readonly validateReads: boolean;

  constructor(opts: DbReaderOptions<TDto>) {
    this.dtoCtor = opts.dtoCtor;
    this.svcEnv = opts.svcEnv;
    this.validateReads = opts.validateReads ?? false;
  }

  // Env-driven; no guessing collection names
  private async collection(): Promise<any> {
    return getMongoCollectionFromSvcEnv(this.svcEnv);
  }

  // Best-effort coercion: string/"$oid" → ObjectId, else fall back to raw
  private coerceObjectId(id: unknown): unknown {
    if (!id) return id;
    if (typeof id === "string") {
      try {
        return new ObjectId(id);
      } catch {
        return id; // let Mongo match fail naturally if not a valid ObjectId
      }
    }
    if (typeof id === "object" && id !== null && "$oid" in (id as any)) {
      const s = String((id as any)["$oid"] ?? "");
      try {
        return new ObjectId(s);
      } catch {
        return s;
      }
    }
    return id;
  }

  /** Recursively coerce any `_id` comparison values inside a Mongo filter to ObjectId. */
  private coerceObjectIdsInQuery = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(this.coerceObjectIdsInQuery);
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "_id") {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            // { _id: { $gt: val, $lt: val2 } }
            const inner: Record<string, unknown> = {};
            for (const [op, iv] of Object.entries(
              v as Record<string, unknown>
            )) {
              inner[op] = this.coerceObjectId(iv);
            }
            out[k] = inner;
          } else {
            out[k] = this.coerceObjectId(v);
          }
        } else {
          out[k] = this.coerceObjectIdsInQuery(v);
        }
      }
      return out;
    }
    return node;
  };

  /** Convenience: find by _id with safe coercion to ObjectId when possible. */
  public async readById(id: unknown): Promise<TDto | undefined> {
    const _id = this.coerceObjectId(id);
    return this.readOne({ _id });
  }

  public async readOne(
    filter: Record<string, unknown>
  ): Promise<TDto | undefined> {
    const col = await this.collection();
    const q = this.coerceObjectIdsInQuery(filter);
    const raw = await col.findOne(q);
    if (!raw) return undefined;
    const normalized = mongoNormalizeId(raw);
    return this.dtoCtor.fromJson(normalized, { validate: this.validateReads });
  }

  /**
   * Legacy convenience: simple capped read without cursor (kept for compatibility).
   * Prefer readBatch() for anything that might need paging now or later.
   */
  public async readMany(
    filter: Record<string, unknown>,
    limit = 100
  ): Promise<TDto[]> {
    const col = await this.collection();
    const q = this.coerceObjectIdsInQuery(filter);
    const cur = col.find(q).limit(limit);
    const out: TDto[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const raw of cur) {
      const normalized = mongoNormalizeId(raw);
      out.push(
        this.dtoCtor.fromJson(normalized, { validate: this.validateReads })
      );
    }
    return out;
  }

  /**
   * Deterministic keyset pagination (no skip/limit drift).
   * - DB does the sort; we add seek filters for the next page based on a cursor.
   * - Returns a DtoBag (immutable) and an opaque nextCursor if more data exists.
   */
  public async readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>> {
    const order = args.order ?? ORDER_STABLE_ID_ASC;
    const baseFilter = args.filter ?? {};
    const limit = args.limit;
    const rev = Boolean(args.rev);

    if (!Number.isFinite(limit) || limit! <= 0) {
      throw new Error(
        "DBREADER_INVALID_LIMIT: `limit` must be a positive integer. Ops: ensure handler enforces sane defaults (e.g., <=1000)."
      );
    }

    // Optional: seek continuation from cursor.
    let seekFilter: Record<string, unknown> | undefined;
    if (args.cursor) {
      const { order: curOrder, last, rev: curRev } = decodeCursor(args.cursor);
      // If caller passed an explicit order, ensure cursor and request match.
      if (args.order && !ordersEqual(order, curOrder)) {
        throw new Error(
          "DBREADER_ORDER_MISMATCH: Cursor order differs from requested order. Ops: client must reuse the exact cursor/order."
        );
      }
      seekFilter = toMongoSeekFilter(curOrder, last, curRev ?? false);
    }

    // Combine and COERCE `_id` operands back to ObjectId for Mongo to compare properly.
    const rawFilter = seekFilter
      ? { $and: [baseFilter, seekFilter] }
      : baseFilter;
    const filter = this.coerceObjectIdsInQuery(rawFilter) as Record<
      string,
      unknown
    >;

    const col = await this.collection();

    // Fetch one extra row to decide if there is another page.
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const raw of cursor) arr.push(raw);
        return arr;
      })());

    // Hydrate normalized docs into DTOs, then into a DtoBag
    const slice = docs.slice(0, limit);
    const dtos = slice.map((raw) =>
      this.dtoCtor.fromJson(mongoNormalizeId(raw), {
        validate: this.validateReads,
      })
    );
    const bag = new DtoBag<TDto>(dtos as readonly TDto[]);

    // nextCursor if there is another page
    let nextCursor: string | undefined;
    if (docs.length > limit && slice.length > 0) {
      const lastDoc = mongoNormalizeId(slice[slice.length - 1]);
      const lastKeyset = keysetFromDoc(lastDoc, order);
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
