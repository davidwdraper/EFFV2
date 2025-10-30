// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/0041/0042/0043/0048
 *
 * Purpose:
 * - Concrete writer: uses **SvcEnvDto** to connect and write dto.toJson().
 * - Normalizes DB response ids to strings on the way back.
 * - Centralizes duplicate-key mapping.
 */

import type { BaseDto } from "../DtoBase";
import { DbManagerBase } from "./DbManagerBase";
import { getMongoCollectionFromSvcEnv } from "./adapters/mongo/connectFromSvcEnv";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "./adapters/mongo/dupeKeyError";
import { coerceForMongoQuery } from "./adapters/mongo/queryHelper";

export class DbWriter<TDto extends BaseDto> extends DbManagerBase<TDto> {
  constructor(params: { dto: TDto; svcEnv: any }) {
    super(params);
  }

  /** Introspection hook for handlers to log target collection. */
  public async targetInfo(): Promise<{ collectionName: string }> {
    const coll = await getMongoCollectionFromSvcEnv(this._svcEnv);
    const collectionName =
      typeof (coll as any)?.collectionName === "string"
        ? (coll as any).collectionName
        : "unknown";
    return { collectionName };
  }

  /** Persist the injected DTO using env-provided connection info. */
  public async write(): Promise<{ id: string }> {
    const coll = await getMongoCollectionFromSvcEnv(this._svcEnv);
    try {
      const res = await coll.insertOne(this._dto.toJson() as any);
      const id = String(res?.insertedId ?? "");
      if (!id) {
        throw new Error(
          "DbWriter.write() missing insertedId. Ops: check Mongo driver response and collection write concerns."
        );
      }
      return { id };
    } catch (err) {
      const dup = parseDuplicateKey(err);
      if (dup) throw new DuplicateKeyError(dup, err as Error);
      throw err;
    }
  }

  /**
   * Update the injected DTO by its id using $set of dto.toJson() (excluding _id).
   * Returns the id on success; throws on 0 matches.
   */
  public async update(): Promise<{ id: string }> {
    const coll = await getMongoCollectionFromSvcEnv(this._svcEnv);

    const json = this._dto.toJson() as Record<string, unknown>;
    const rawId =
      (json?._id as string | undefined) ??
      ((this._dto as any).xxxId as string | undefined) ??
      ((this._dto as any).id as string | undefined);

    if (!rawId || String(rawId).trim() === "") {
      throw new Error(
        "DbWriter.update() missing id. Ops: ensure DTO carries _id (or exposes an id getter) before update()."
      );
    }

    const { _id, ...rest } = json;

    // Canonical coercion for Mongo query {_id: ...}
    const filter = coerceForMongoQuery({ _id: String(rawId) }) as {
      _id: unknown;
    };

    try {
      const res = await coll.updateOne({ _id: filter._id }, { $set: rest });
      const matched =
        typeof res?.matchedCount === "number" ? res.matchedCount : 0;

      if (matched === 0) {
        throw new Error(
          `DbWriter.update() matched 0 documents for _id=${String(
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
