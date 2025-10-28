// backend/services/shared/src/dto/persistence/DbWriter.ts
/**
 * Docs:
 * - ADR-0040/0041/0042/0043
 *
 * Purpose:
 * - Concrete writer: uses **SvcEnvDto** to connect and write dto.toJson().
 * - Maps Mongo duplicate key errors to a structured DuplicateKeyError.
 */

import type { BaseDto } from "../base.dto";
import { DbManagerBase } from "./DbManagerBase";
import { getMongoCollectionFromSvcEnv } from "./adapters/mongo/connectFromSvcEnv";
import {
  parseDuplicateKey,
  DuplicateKeyError,
} from "./adapters/mongo/dupeKeyError";

export class DbWriter<TDto extends BaseDto> extends DbManagerBase<TDto> {
  constructor(params: { dto: TDto; svcEnv: any }) {
    super(params);
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
      if (dup) {
        // Surface a typed, structured duplicate for handlers to downgrade
        throw new DuplicateKeyError(dup, err as Error);
      }
      throw err;
    }
  }

  /**
   * Update the injected DTO by its _id using $set of dto.toJson() (excluding _id).
   * Returns the id on success; throws on 0 matches.
   */
  public async update(): Promise<{ id: string }> {
    const coll = await getMongoCollectionFromSvcEnv(this._svcEnv);

    // Canonical JSON from DTO (source of truth)
    const json = this._dto.toJson() as Record<string, unknown>;

    // Resolve the id (prefer explicit _id from JSON; fall back to common DTO getters)
    const rawId =
      (json?._id as string | undefined) ??
      // BaseDto often exposes .id; specific DTOs (e.g., XxxDto) may expose alias getters
      ((this._dto as any).xxxId as string | undefined) ??
      ((this._dto as any).id as string | undefined);

    if (!rawId || String(rawId).trim() === "") {
      throw new Error(
        "DbWriter.update() missing id. Ops: ensure DTO carries _id (or exposes an id getter) before calling update()."
      );
    }

    // _id is immutable; never try to update it
    const { _id, ...rest } = json;

    // Coerce to ObjectId if it looks like a 24-hex; fall back to raw string
    const filterId = await coerceMongoId(String(rawId));

    try {
      const res = await coll.updateOne({ _id: filterId }, { $set: rest });
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
      if (dup) {
        // Surface a typed, structured duplicate for handlers to downgrade
        throw new DuplicateKeyError(dup, err as Error);
      }
      throw err;
    }
  }
}

export { DuplicateKeyError }; // convenient re-export for handlers

// ────────────────────────────────────────────────────────────────────────────
// Helpers (local)
// ────────────────────────────────────────────────────────────────────────────

/**
 * If the id looks like a Mongo ObjectId (24 hex chars), return a new ObjectId.
 * Otherwise return the raw string id. Uses dynamic import to avoid hard deps.
 */
async function coerceMongoId(id: string): Promise<any> {
  const hex24 = /^[a-f0-9]{24}$/i.test(id);
  if (!hex24) return id;
  try {
    const { ObjectId } = await import("mongodb" as any);
    return new (ObjectId as any)(id);
  } catch {
    // If mongodb isn’t available at compile-time for some services, fall back safely
    return id;
  }
}
