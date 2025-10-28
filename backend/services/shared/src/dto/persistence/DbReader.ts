// backend/services/shared/src/dto/persistence/DbReader.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; reads hydrate DTOs with validate=false by default
 * - ADR-0040 (DTO-Only Persistence)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Read one/many records from Mongo and hydrate DTOs.
 * - Uses env-driven collection resolution (NV_MONGO_URI / NV_MONGO_DB / NV_MONGO_COLLECTION).
 * - Normalizes Mongo-native shapes (e.g., _id:ObjectId) before DTO.fromJson().
 */

import type { SvcEnvDto } from "../svcenv.dto";
import { getMongoCollectionFromSvcEnv } from "./adapters/mongo/connectFromSvcEnv";
import { mongoNormalizeId } from "./adapters/mongo/mongoNormalizeId";
import { ObjectId } from "mongodb";

type Ctor<T> = {
  fromJson: (j: unknown, opts?: { validate?: boolean }) => T;
};

type DbReaderOptions<T> = {
  dtoCtor: Ctor<T>;
  svcEnv: SvcEnvDto;
  validateReads?: boolean; // default false (trust our own writes)
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

  /** Convenience: find by _id with safe coercion to ObjectId when possible. */
  public async readById(id: unknown): Promise<TDto | undefined> {
    const _id = this.coerceObjectId(id);
    return this.readOne({ _id });
  }

  public async readOne(
    filter: Record<string, unknown>
  ): Promise<TDto | undefined> {
    const col = await this.collection();
    const raw = await col.findOne(filter);
    if (!raw) return undefined;
    const normalized = mongoNormalizeId(raw);
    return this.dtoCtor.fromJson(normalized, { validate: this.validateReads });
  }

  public async readMany(
    filter: Record<string, unknown>,
    limit = 100
  ): Promise<TDto[]> {
    const col = await this.collection();
    const cur = col.find(filter).limit(limit);
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
}
