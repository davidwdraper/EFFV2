// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/db.update.ts
/**
 * Docs:
 * - SOP: DTO-first; bag-centric processing
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0048 (Revised — all reads/writes speak DtoBag)
 *   - ADR-0050 (Wire Bag Envelope; singleton inbound)
 *   - ADR-0053 (Bag Purity; no naked DTOs on the bus)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Consume the UPDATED singleton DtoBag from ctx["bag"] and persist via DbWriter.update().
 * - Duplicate key → HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<EnvServiceDto> (UPDATED singleton; from ApplyPatchUpdateHandler)
 *
 * Outputs (ctx, final-handler invariant):
 * - On success:
 *   - "bag": DtoBag<EnvServiceDto> (persisted singleton bag)
 *   - "dbWriter.lastId": string (updated id)
 *   - "handlerStatus": "ok"
 * - On error:
 *   - failWithError(...) sets handlerStatus="error" + response.status/body
 *
 * Invariants:
 * - No controller.getSvcEnv() checks (sandbox owns env plumbing).
 * - No success payload outside ctx["bag"].
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.update";
  }

  protected handlerPurpose(): string {
    return "Persist a singleton updated DTO from ctx['bag'] via DbWriter.update(), mapping duplicate-key to HTTP 409.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    // --- Required context: singleton bag ------------------------------------
    const bag = this.safeCtxGet<DtoBag<DtoBase>>("bag");
    if (!bag) {
      this.failWithError({
        httpStatus: 500,
        title: "bag_missing",
        detail:
          "Updated DtoBag missing. Dev: ensure the update pipeline produces ctx['bag'] before db.update runs.",
        stage: "db.update:config.bag",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "env-service.update.db.update: ctx['bag'] missing.",
        logLevel: "error",
      });
      return;
    }

    const size = Array.from(bag.items()).length;
    if (size !== 1) {
      this.failWithError({
        httpStatus: 400,
        title: "bag_singleton_violation",
        detail:
          size === 0
            ? "Update requires exactly one item in the bag; received 0."
            : `Update requires exactly one item in the bag; received ${size}.`,
        stage: "db.update:business.ensureSingleton",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [{ size }],
        logMessage:
          "env-service.update.db.update: singleton invariant violated for ctx['bag'].",
        logLevel: "warn",
      });
      return;
    }

    // ---- Missing DB config throws ------------------------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // --- External edge: DB update -------------------------------------------
    try {
      const writer = new DbWriter<DtoBase>({
        bag,
        mongoUri,
        mongoDb,
        log: this.log,
        userId: this.safeCtxGet<string>("userId"),
      });

      // (Best-effort) introspection for logs; never fatal
      try {
        const tgt = await writer.targetInfo();
        this.log.debug(
          { event: "update_target", collection: tgt.collectionName, requestId },
          "env-service.update.db.update: resolved target collection"
        );
      } catch {
        // ignore
      }

      const { id } = await writer.update();

      // IMPORTANT:
      // - Keep the returned/persisted bag if writer returns one in the future.
      // - Today update() returns {id}; the bag already contains the updated DTO.
      // - finalize() uses ctx["bag"].
      this.ctx.set("dbWriter.lastId", id);
      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        { event: "update_ok", id, requestId },
        "env-service.update.db.update: update succeeded"
      );
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        this.failWithError({
          httpStatus: 409,
          title: "duplicate_key",
          detail:
            err.message ??
            "Duplicate key encountered while attempting to update a document.",
          stage: "db.update:db.write.duplicateKey",
          requestId,
          rawError: err,
          origin: { file: __filename, method: "execute" },
          logMessage:
            "env-service.update.db.update: duplicate key on DbWriter.update().",
          logLevel: "warn",
        });
        return;
      }

      this.failWithError({
        httpStatus: 500,
        title: "db_update_failed",
        detail:
          (err as Error)?.message ??
          "DbWriter.update() failed while updating a DtoBag.",
        stage: "db.update:db.write",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.update.db.update: unexpected error during DbWriter.update().",
        logLevel: "error",
      });
    }
  }
}
