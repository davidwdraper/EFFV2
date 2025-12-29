// backend/services/shared/src/http/handlers/db.update.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *
 * Purpose:
 * - Consume the UPDATED singleton DtoBag<DtoBase> from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Persist an updated singleton DtoBag<DtoBase> via DbWriter.update() using the id inside the bag.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "execute_enter", handler: this.constructor.name, requestId },
      "bag.toDb.update enter"
    );

    const bag = this.ctx.get<DtoBag<DtoBase>>("bag");
    if (!bag) {
      this.failWithError({
        httpStatus: 400,
        title: "bag_missing",
        detail:
          "Updated DtoBag missing from ctx['bag']. Dev: ensure upstream patch handler populated ctx['bag'] before db.update.",
        stage: "config.bag",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasBag: !!bag, targetKey: "bag" }],
        logMessage: "bag.toDb.update — ctx['bag'] missing.",
        logLevel: "warn",
      });
      return;
    }

    const items = Array.from(bag.items());
    const size = items.length;
    if (size !== 1) {
      this.failWithError({
        httpStatus: 400,
        title: "bag_update_singleton_violation",
        detail:
          size === 0
            ? "Update requires exactly one item in the bag; received 0."
            : `Update requires exactly one item in the bag; received ${size}.`,
        stage: "business.ensureSingleton",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ size, targetKey: "bag" }],
        logMessage: "bag.toDb.update — singleton requirement failed.",
        logLevel: "warn",
      });
      return;
    }

    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();
    const baseBag = bag as DtoBag<DtoBase>;

    try {
      const writer = new DbWriter<DtoBase>({
        bag: baseBag,
        mongoUri,
        mongoDb,
        log: this.log,
      });

      const { collectionName } = (await writer.targetInfo?.()) ?? {
        collectionName: "<unknown>",
      };

      this.log.debug(
        {
          event: "update_target",
          handler: this.constructor.name,
          collection: collectionName,
          requestId,
        },
        "bag.toDb.update will write to collection"
      );

      const { id } = await writer.update();

      this.ctx.set("updatedId", id);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          handler: this.constructor.name,
          id,
          collection: collectionName,
          requestId,
        },
        "bag.toDb.update exit — update complete"
      );
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        const keyObj = err.key ?? {};
        const keyPath = Object.keys(keyObj).join(",");

        this.failWithError({
          httpStatus: 409,
          title: "duplicate_key",
          detail:
            (err as Error)?.message ??
            "Unique constraint violation (duplicate key) during update.",
          stage: "db.update.duplicateKey",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ key: err.key, index: err.index, keyPath }],
          rawError: err,
          logMessage: "bag.toDb.update — duplicate key (409).",
          logLevel: "warn",
        });
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "db_update_failed",
        detail:
          (err as Error)?.message ??
          "DbWriter.update() failed while persisting an updated DtoBag.",
        stage: "db.update",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasBag: !!bag, size }],
        rawError: err,
        logMessage: "bag.toDb.update — DbWriter.update() threw.",
        logLevel: "error",
      });
    }
  }
}
