// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/bagToDb.handler.ts
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
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import {
  DbWriter,
  DuplicateKeyError,
} from "@nv/shared/dto/persistence/DbWriter";

export class BagToDbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "bagToDb.update enter");

    const requestId =
      (this.ctx.get<string>("requestId") as string | undefined) ?? "unknown";

    // --- Required context ----------------------------------------------------
    const bag = this.ctx.get<DtoBag<EnvServiceDto>>("bag");
    if (!bag) {
      this._badRequest(
        "BAG_MISSING",
        "Updated DtoBag missing. Ensure ApplyPatchUpdateHandler ran.",
        requestId
      );
      this.log.error(
        { event: "bag_missing", requestId },
        "BagToDbUpdateHandler: ctx['bag'] missing"
      );
      return;
    }

    const items = Array.from(bag.items());
    if (items.length !== 1) {
      this._badRequest(
        items.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        items.length === 0
          ? "Update requires exactly one item; received 0."
          : "Update requires exactly one item; received more than 1.",
        requestId
      );
      this.log.warn(
        { event: "bag_size_invalid", size: items.length, requestId },
        "BagToDbUpdateHandler: singleton invariant violated"
      );
      return;
    }

    // --- svcEnv → NV_MONGO_URI / NV_MONGO_DB (no ctx / no process.env) ------
    const svcEnv = this.controller.getSvcEnv?.();
    if (!svcEnv || typeof svcEnv.getEnvVar !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "SERVICE_ENV_UNAVAILABLE",
        title: "Internal Error",
        detail:
          "Service environment configuration is unavailable. Ops: ensure AppBase/ControllerBase seeds svcEnv with NV_MONGO_URI/NV_MONGO_DB.",
        requestId,
      });
      this.log.error(
        { event: "svc_env_unavailable", requestId },
        "BagToDbUpdateHandler: svcEnv unavailable or invalid"
      );
      return;
    }

    let mongoUri: string;
    let mongoDb: string;
    try {
      mongoUri = svcEnv.getEnvVar("NV_MONGO_URI");
      mongoDb = svcEnv.getEnvVar("NV_MONGO_DB");
    } catch (err) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "SERVICE_DB_CONFIG_MISSING",
        title: "Internal Error",
        detail:
          (err as Error)?.message ??
          "Missing NV_MONGO_URI/NV_MONGO_DB in env-service configuration. Ops: ensure these keys exist and are valid.",
        requestId,
      });

      this.log.error(
        {
          event: "service_db_config_missing",
          err:
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : err,
          requestId,
        },
        "BagToDbUpdateHandler: failed to resolve DB config from EnvServiceDto"
      );
      return;
    }

    // --- Writer (bag-centric) -----------------------------------------------
    const writer = new DbWriter<EnvServiceDto>({
      bag,
      mongoUri,
      mongoDb,
      log: this.log,
    });

    try {
      const { collectionName } = (await writer.targetInfo?.()) ?? {
        collectionName: "<unknown>",
      };
      this.log.debug(
        { event: "update_target", collection: collectionName, requestId },
        "update will write to collection"
      );

      // Bag-centric update; writer determines the id from the DTO inside the bag.
      const { id } = await writer.update();

      this.log.debug(
        { event: "update_complete", id, collection: collectionName, requestId },
        "update complete"
      );

      // Keep the updated bag on ctx["bag"]; finalize() will build the wire payload.
      this.ctx.set("bag", bag);
      this.ctx.set("updatedId", id);
      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        { event: "update_ok", id, collection: collectionName, requestId },
        "BagToDbUpdateHandler: update succeeded"
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
          "BagToDbUpdateHandler: update duplicate — returning 409"
        );

        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 409);
        this.ctx.set("response.body", {
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
          requestId,
        });
      } else {
        const message = (err as Error)?.message ?? String(err);
        this.log.error(
          {
            event: "db_update_failed",
            error: message,
            requestId,
          },
          "BagToDbUpdateHandler: update failed unexpectedly"
        );

        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 500);
        this.ctx.set("response.body", {
          code: "DB_UPDATE_FAILED",
          title: "Internal Error",
          detail: message,
          requestId,
        });
      }
    }

    this.log.debug({ event: "execute_exit", requestId }, "bagToDb.update exit");
  }

  private _badRequest(code: string, detail: string, requestId: string): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("response.status", 400);
    this.ctx.set("response.body", {
      code,
      title: "Bad Request",
      detail,
      requestId,
    });
  }
}
