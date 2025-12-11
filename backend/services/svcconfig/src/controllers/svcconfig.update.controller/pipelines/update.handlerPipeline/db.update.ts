// backend/services/svcconfig/src/controllers/svcconfig.update.controller/pipelines/update.handlerPipeline/db.update.ts
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
 * - Consume the UPDATED **singleton DtoBag** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<SvcconfigDto>   (UPDATED singleton; from ApplyPatchUpdateHandler)
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

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - db.<dbName>.<collectionName>.<op>
   *
   * For svcconfig update:
   * - DB: nv
   * - Collection: svcconfig
   * - Op: update-one
   */
  public handlerName(): string {
    return "db.nv.svcconfig.update-one";
  }

  protected handlerPurpose(): string {
    return "Execute a bag-centric update of a singleton svcconfig DtoBag via DbWriter and expose the updated id on ctx['result'].";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.handlerName(),
        requestId,
      },
      "DbUpdateHandler.execute bagToDb.update enter"
    );

    // --- Required context: bag ------------------------------------------------
    const bag = this.safeCtxGet<DtoBag<any>>("bag");
    if (!bag) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request",
        detail:
          "Updated DtoBag missing. Ensure ApplyPatchUpdateHandler ran and set ctx['bag'].",
        stage: "svcconfig.update.dbUpdate.bag_missing",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            key: "bag",
            present: false,
          },
        ],
        logMessage:
          "DbUpdateHandler.execute missing updated DtoBag for svcconfig update",
        logLevel: "warn",
      });
      return;
    }

    const items = Array.from(bag.items());
    if (items.length !== 1) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request",
        detail:
          items.length === 0
            ? "Update requires exactly one item; received 0."
            : "Update requires exactly one item; received more than 1.",
        stage: "svcconfig.update.dbUpdate.singleton",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            key: "bag.items",
            length: items.length,
          },
        ],
        logMessage:
          "DbUpdateHandler.execute invalid DtoBag cardinality for svcconfig update",
        logLevel: "warn",
      });
      return;
    }

    // ---- Missing DB config throws ------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // Optional: diagnose whether ControllerBase is actually holding svcEnv.
    const svcEnv = (this.controller as any).getSvcEnv?.();
    const hasSvcEnv = !!svcEnv;

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
          handler: this.handlerName(),
          collection: collectionName,
          requestId,
        },
        "DbUpdateHandler.execute update will write to collection"
      );

      // Bag-centric update; writer determines the id from the DTO inside the bag.
      const { id } = await writer.update();

      this.log.debug(
        {
          event: "update_complete",
          handler: this.handlerName(),
          id,
          collection: collectionName,
          requestId,
        },
        "DbUpdateHandler.execute update complete"
      );

      this.ctx.set("updatedId", id);
      this.ctx.set("result", { ok: true, id });
      this.ctx.set("status", 200);
      this.ctx.set("handlerStatus", "ok");
    } catch (err: any) {
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
          ...(this.safeCtxGet<any[]>("warnings") ?? []),
          warning,
        ]);

        this.failWithError({
          httpStatus: 409,
          title: "conflict",
          detail: (err as Error).message,
          stage: "svcconfig.update.dbUpdate.duplicate",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: keyPath
            ? [
                {
                  path: keyPath,
                  code: "unique",
                  message: "duplicate value",
                },
              ]
            : undefined,
          rawError: err,
          logMessage:
            "DbUpdateHandler.execute duplicate key during svcconfig update; returning 409",
          logLevel: "warn",
        });

        // Preserve legacy expectations: status + error code shape for controller/wire.
        this.ctx.set("status", 409);
        this.ctx.set("error", {
          code: "DUPLICATE",
          title: "Conflict",
          detail: (err as Error).message,
          issues: keyPath
            ? [
                {
                  path: keyPath,
                  code: "unique",
                  message: "duplicate value",
                },
              ]
            : undefined,
        });

        return;
      }

      // Non-duplicate errors → structured 500, no rethrow.
      this.failWithError({
        httpStatus: 500,
        title: "db_update_failed",
        detail:
          "Database update for svcconfig document failed unexpectedly. Ops: inspect logs for handler and requestId.",
        stage: "svcconfig.update.dbUpdate.unhandled",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hint: "Check Mongo connectivity, collection indexes, and DbWriter configuration.",
          },
        ],
        rawError: err,
        logMessage:
          "DbUpdateHandler.execute unhandled exception during svcconfig DbWriter.update()",
        logLevel: "error",
      });
      return;
    }

    this.log.debug(
      {
        event: "execute_exit",
        handler: this.handlerName(),
        status: this.safeCtxGet<number>("status") ?? 200,
        requestId,
      },
      "DbUpdateHandler.execute bagToDb.update exit"
    );
  }
}
