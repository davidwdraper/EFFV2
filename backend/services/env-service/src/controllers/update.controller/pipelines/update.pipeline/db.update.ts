// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/db.update.ts
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
 * - Consume the UPDATED **singleton DtoBag** from ctx["bag"] and execute an update().
 * - Duplicate key → WARN + HTTP 409 (mirrors create).
 *
 * Inputs (ctx):
 * - "bag": DtoBag<EnvServiceDto>   (UPDATED singleton; from ApplyPatchUpdateHandler)
 *
 * Outputs (ctx, invariant as final handler):
 * - On success:
 *   - "bag": DtoBag<EnvServiceDto> (updated DTO in a singleton bag)
 *   - "updatedId": string (id of the updated record)
 *   - "handlerStatus": "ok"
 *   - NO "result" on success
 *   - NO "response.body" on success
 * - On error:
 *   - "handlerStatus": "error"
 *   - "response.status": number
 *   - "response.body": problem+json-style object
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/dbWriter/DbWriter";

export class DbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Persist a singleton updated EnvServiceDto from ctx['bag'] via DbWriter.update(), mapping duplicate-key to HTTP 409.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "env_service_update_db_start", requestId },
      "env-service.update.db.update: enter"
    );

    try {
      // --- Required context: singleton bag ----------------------------------
      const bag = this.ctx.get<DtoBag<EnvServiceDto>>("bag");

      if (!bag) {
        this.failWithError({
          httpStatus: 400,
          title: "bag_missing",
          detail:
            "Updated DtoBag missing. Ensure ApplyPatchUpdateHandler ran before DbUpdateHandler.",
          stage: "update.db.bag.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.update: ctx['bag'] missing; expected updated singleton bag.",
          logLevel: "error",
        });
        this.log.error(
          { event: "bag_missing", requestId },
          "env-service.update.db.update: ctx['bag'] missing"
        );
        return;
      }

      const items = Array.from(bag.items());
      if (items.length !== 1) {
        const isEmpty = items.length === 0;

        this.failWithError({
          httpStatus: 400,
          title: isEmpty ? "empty_items" : "too_many_items",
          detail: isEmpty
            ? "Update requires exactly one item; received 0."
            : "Update requires exactly one item; received more than 1.",
          stage: isEmpty ? "update.db.bag.empty" : "update.db.bag.too_many",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage: isEmpty
            ? "env-service.update.db.update: bag empty; expected singleton."
            : "env-service.update.db.update: bag contained multiple items; expected singleton.",
          logLevel: "warn",
        });

        this.log.warn(
          {
            event: "bag_size_invalid",
            size: items.length,
            requestId,
          },
          "env-service.update.db.update: singleton invariant violated"
        );
        return;
      }

      // --- svcEnv → NV_MONGO_URI / NV_MONGO_DB (no ctx / no process.env) ----
      const svcEnv = this.controller.getSvcEnv?.();
      if (!svcEnv || typeof svcEnv.getEnvVar !== "function") {
        this.failWithError({
          httpStatus: 500,
          title: "service_env_unavailable",
          detail:
            "Service environment configuration is unavailable. Ops: ensure AppBase/ControllerBase seeds svcEnv with NV_MONGO_URI/NV_MONGO_DB.",
          stage: "update.db.svcEnv.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.update: svcEnv unavailable or invalid.",
          logLevel: "error",
        });
        this.log.error(
          { event: "svc_env_unavailable", requestId },
          "env-service.update.db.update: svcEnv unavailable or invalid"
        );
        return;
      }

      // ---- Missing DB config throws ------------------------
      const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

      // --- Writer (bag-centric) ---------------------------------------------
      let writer: DbWriter<EnvServiceDto>;
      try {
        writer = new DbWriter<EnvServiceDto>({
          bag,
          mongoUri,
          mongoDb,
          log: this.log,
        });
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "db_writer_init_failed",
          detail:
            (err as Error)?.message ??
            "Failed to construct DbWriter for env-service update. Ops: verify Mongo URI/DB and DTO wiring.",
          stage: "update.db.writer.init",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.update: DbWriter<EnvServiceDto> construction failed.",
          logLevel: "error",
        });
        return;
      }

      try {
        const { collectionName } = (await writer.targetInfo?.()) ?? {
          collectionName: "<unknown>",
        };
        this.log.debug(
          { event: "update_target", collection: collectionName, requestId },
          "env-service.update.db.update: update will write to collection"
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
          "env-service.update.db.update: update complete"
        );

        // Keep the updated bag on ctx["bag"]; finalize() will build the wire payload.
        this.ctx.set("bag", bag);
        this.ctx.set("updatedId", id);
        this.ctx.set("handlerStatus", "ok");

        this.log.info(
          {
            event: "update_ok",
            id,
            collection: collectionName,
            requestId,
          },
          "env-service.update.db.update: update succeeded"
        );
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

          this.log.warn(
            {
              event: "duplicate_key",
              index: err.index,
              key: err.key,
              detail: (err as Error).message,
              requestId,
            },
            "env-service.update.db.update: update duplicate — returning 409"
          );

          this.failWithError({
            httpStatus: 409,
            title: "duplicate",
            detail: (err as Error).message,
            stage: "update.db.duplicate_key",
            requestId,
            rawError: err,
            origin: {
              file: __filename,
              method: "execute",
            },
            logMessage:
              "env-service.update.db.update: DuplicateKeyError during update().",
            logLevel: "warn",
          });

          // If you ever want issues[] back on the response, this is where we'd
          // extend the problem payload once HandlerBase supports extensions.
          if (keyPath) {
            const body = this.ctx.get<any>("response.body") ?? {};
            this.ctx.set("response.body", {
              ...body,
              issues: [
                {
                  path: keyPath,
                  code: "unique",
                  message: "duplicate value",
                },
              ],
            });
          }
        } else {
          const message = (err as Error)?.message ?? String(err);
          this.log.error(
            {
              event: "db_update_failed",
              error: message,
              requestId,
            },
            "env-service.update.db.update: update failed unexpectedly"
          );

          this.failWithError({
            httpStatus: 500,
            title: "db_update_failed",
            detail: message,
            stage: "update.db.update_failed",
            requestId,
            rawError: err,
            origin: {
              file: __filename,
              method: "execute",
            },
            logMessage:
              "env-service.update.db.update: DbWriter.update() threw unexpectedly.",
            logLevel: "error",
          });
        }
      }

      this.log.debug(
        { event: "env_service_update_db_end", requestId },
        "env-service.update.db.update: exit"
      );
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "update_db_handler_failure",
        detail:
          "Unhandled exception while updating EnvServiceDto. Ops: inspect logs for requestId and stack frame.",
        stage: "update.db.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.update.db.update: unhandled exception in handler execute().",
        logLevel: "error",
      });
    }
  }
}
