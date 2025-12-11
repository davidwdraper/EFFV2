// backend/services/user-auth/src/controllers/user-auth.update.controller/handlers/bagToDb.update.handler.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *
 * Purpose:
 * - Consume the UPDATED **singleton DtoBag** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<UserAuthDto>   (UPDATED singleton; from ApplyPatchUpdateHandler)
 *
 * Outputs (ctx):
 * - "result": { ok: true, id }
 * - "status": 200
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

export class BagToDbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Ops-facing one-liner for logs and errors.
   */
  protected handlerPurpose(): string {
    return "user-auth.update.bagToDb: persist updated singleton DtoBag via DbWriter.update()";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    this.log.debug(
      { event: "execute_enter", requestId },
      "bagToDb.update enter"
    );

    // --- Required context ----------------------------------------------------
    const bag = this.ctx.get<DtoBag<any>>("bag");
    if (!bag) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_bag_missing",
        detail:
          "Updated DtoBag missing on ctx['bag']. Ops: ensure ApplyPatchUpdateHandler (or equivalent) ran and populated ctx['bag'] before BagToDbUpdateHandler.",
        stage: "bagToDb.update.setup.bag",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "user-auth.update.bagToDb: ctx['bag'] missing; cannot perform update().",
        logLevel: "warn",
      });
      return;
    }

    const items = Array.from(bag.items());
    if (items.length !== 1) {
      const code =
        items.length === 0
          ? "empty_bag_for_update"
          : "too_many_items_for_update";

      this.failWithError({
        httpStatus: 400,
        title: "bad_request_invalid_bag_size",
        detail:
          items.length === 0
            ? "Update requires exactly one item in ctx['bag']; received 0."
            : `Update requires exactly one item in ctx['bag']; received ${items.length}.`,
        stage: "bagToDb.update.setup.bag_size",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            path: "bag.items",
            code,
            message: "Update operations must be singleton.",
          },
        ],
        logMessage:
          "user-auth.update.bagToDb: invalid bag size for update (must be singleton).",
        logLevel: "warn",
      });
      return;
    }

    // ---- Missing DB config throws via HandlerBase.getMongoConfig() ---------
    // Any failure here will:
    // - call failWithError(...) with a mongo_config_error
    // - throw, which HandlerBase.run() treats as already-handled
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // Optional: diagnose whether ControllerBase is actually holding svcEnv.
    const svcEnv = this.controller.getSvcEnv?.();
    const hasSvcEnv = !!svcEnv;
    this.log.debug(
      {
        event: "svcenv_check",
        requestId,
        hasSvcEnv,
      },
      "bagToDb.update: svcEnv presence check"
    );

    // --- Writer (bag-centric; use DtoBase for DbWriter contract) ------------
    const baseBag = bag as unknown as DtoBag<DtoBase>;
    const writer = new DbWriter<DtoBase>({
      bag: baseBag,
      mongoUri,
      mongoDb,
      log: this.log,
    });

    try {
      const { collectionName } = (await writer.targetInfo?.()) ?? {
        collectionName: "<unknown>",
      };
      this.log.debug(
        {
          event: "update_target",
          collection: collectionName,
          requestId,
        },
        "bagToDb.update: update will write to collection"
      );

      // Bag-centric update; writer determines the id from the DTO inside the bag.
      const { id } = await writer.update();

      this.log.debug(
        {
          event: "update_complete",
          id,
          collection: collectionName,
          requestId,
        },
        "bagToDb.update: update complete"
      );

      this.ctx.set("updatedId", id);
      this.ctx.set("result", { ok: true, id });
      this.ctx.set("status", 200);
      this.ctx.set("handlerStatus", "ok");
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        const keyObj = err.key ?? {};
        const keyPath = Object.keys(keyObj).join(",");

        const warning = {
          code: "DUPLICATE",
          message: "Unique constraint violation (duplicate key).",
          detail: (err as Error).message,
          index: err.index,
          key: err.key,
        };
        this.ctx.set("warnings", [
          ...(this.ctx.get<any[]>("warnings") ?? []),
          warning,
        ]);

        this.failWithError({
          httpStatus: 409,
          title: "duplicate_key_conflict",
          detail:
            "Update failed due to a unique constraint violation (duplicate key). " +
            "Ops: inspect the conflict index/key in the error payload and ensure user-auth uniqueness rules are satisfied.",
          stage: "bagToDb.update.db.duplicate",
          requestId,
          issues: keyPath
            ? [
                {
                  path: keyPath,
                  code: "unique",
                  message: "duplicate value",
                },
              ]
            : undefined,
          origin: {
            file: __filename,
            method: "execute",
          },
          rawError: err,
          logMessage:
            "user-auth.update.bagToDb: DuplicateKeyError during DbWriter.update(); returning 409 Conflict.",
          logLevel: "warn",
        });
      } else {
        this.failWithError({
          httpStatus: 500,
          title: "db_update_failed",
          detail:
            "Database update failed while persisting the updated user-auth record. " +
            "Ops: inspect logs for this requestId, validate Mongo connectivity, DB_STATE mapping, and user-auth collection indexes.",
          stage: "bagToDb.update.db.generic",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          rawError: err,
          logMessage:
            "user-auth.update.bagToDb: DbWriter.update() threw unexpected error.",
          logLevel: "error",
        });
      }
    }

    this.log.debug({ event: "execute_exit", requestId }, "bagToDb.update exit");
  }
}
