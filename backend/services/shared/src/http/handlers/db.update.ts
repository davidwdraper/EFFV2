// backend/services/shared/src/http/handlers/db.update.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Consume the UPDATED **singleton DtoBag<DtoBase>** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<DtoBase>   (UPDATED singleton; from code.patch / ApplyPatchUpdateHandler)
 *
 * Outputs (ctx):
 * - On success:
 *   - "bag": DtoBag<DtoBase> (same updated bag that was passed in)
 *   - "updatedId": string    (id that was updated; for diagnostics/logging)
 *   - "handlerStatus": "ok"
 * - On error only:
 *   - ctx["error"]: NvHandlerError (mapped to ProblemDetails by finalize)
 *   - ctx["handlerStatus"]: "error"
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/DbWriter";

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Persist an updated singleton DtoBag<DtoBase> via DbWriter.update() using the id inside the bag.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "bag.toDb.update enter"
    );

    // --- Required bag -------------------------------------------------------
    const bag = this.ctx.get<DtoBag<DtoBase>>("bag");
    if (!bag) {
      this.failWithError({
        httpStatus: 400,
        title: "bag_missing",
        detail:
          "Updated DtoBag missing from ctx['bag']. Dev: ensure upstream patch handler populated ctx['bag'] before db.update.",
        stage: "config.bag",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasBag: !!bag,
            targetKey: "bag",
          },
        ],
        logMessage:
          "bag.toDb.update — required DtoBag missing from context at ctx['bag'].",
        logLevel: "warn",
      });
      return;
    }

    const items = Array.from(bag.items());
    const size = items.length;
    if (size !== 1) {
      const code =
        size === 0 ? "BAG_UPDATE_EMPTY" : "BAG_UPDATE_TOO_MANY_ITEMS";

      this.failWithError({
        httpStatus: 400,
        title: "bag_update_singleton_violation",
        detail:
          size === 0
            ? "Update requires exactly one item in the bag; received 0."
            : `Update requires exactly one item in the bag; received ${size}.`,
        stage: "business.ensureSingleton",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            size,
            code,
            targetKey: "bag",
          },
        ],
        logMessage:
          "bag.toDb.update — singleton requirement failed for update operation.",
        logLevel: "warn",
      });
      return;
    }

    // --- Env via HandlerBase.getVar (aligned with DbCreateHandler) ----------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    const svcEnv = this.controller.getSvcEnv?.();
    const hasSvcEnv = !!svcEnv;

    if (!mongoUri || !mongoDb) {
      this.failWithError({
        httpStatus: 500,
        title: "mongo_env_missing",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        stage: "config.mongoEnv",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasSvcEnv,
            mongoUriPresent: !!mongoUri,
            mongoDbPresent: !!mongoDb,
          },
        ],
        logMessage:
          "bag.toDb.update aborted — Mongo env config missing (NV_MONGO_URI / NV_MONGO_DB).",
        logLevel: "error",
      });
      return;
    }

    // --- Writer (bag-centric; use DtoBase for DbWriter contract) ------------
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

      // Bag-centric update; writer determines the id from the DTO inside the bag.
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
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              key: err.key,
              index: err.index,
              keyPath,
            },
          ],
          rawError: err,
          logMessage:
            "bag.toDb.update — duplicate key on DbWriter.update() (returning 409).",
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
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasBag: !!bag,
            size,
          },
        ],
        rawError: err,
        logMessage:
          "bag.toDb.update — unexpected error during DbWriter.update().",
        logLevel: "error",
      });
      return;
    }
  }
}
