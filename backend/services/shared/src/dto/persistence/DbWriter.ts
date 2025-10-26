// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/0041/0042/0043
 *
 * Purpose:
 * - Concrete writer: uses **SvcEnvDto** to connect and write dto.toJson().
 */

import type { BaseDto } from "../base.dto";
import { DbManagerBase } from "./DbManagerBase";
import { getMongoCollectionFromSvcEnv } from "./adapters/mongo/connectFromSvcEnv";

export class DbWriter<TDto extends BaseDto> extends DbManagerBase<TDto> {
  constructor(params: { dto: TDto; svcEnv: any }) {
    super(params);
  }

  /** Persist the injected DTO using env-provided connection info. */
  public async write(): Promise<{ id: string }> {
    const coll = await getMongoCollectionFromSvcEnv(this._svcEnv);
    const res = await coll.insertOne(this._dto.toJson() as any);
    const id = String(res?.insertedId ?? "");
    if (!id) {
      throw new Error(
        "DbWriter.write() missing insertedId. Ops: check Mongo driver response and collection write concerns."
      );
    }
    return { id };
  }
}
