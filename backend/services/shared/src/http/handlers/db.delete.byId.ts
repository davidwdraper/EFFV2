// backend/services/shared/src/http/handlers/db.delete.byId.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; adapter edge coercion)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0048 (Reader/Writer/Deleter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id="_id")
 *   - ADR-0056 (Typed routes use :dtoType; handler resolves collection via Registry)
 *
 * Purpose:
 * - Generic DELETE-by-id handler for typed routes:
 *   DELETE /api/:slug/v:version/:dtoType/delete/:id
 * - Resolves the MongoDB collection from the service DtoRegistry using ctx["dtoType"],
 *   validates the canonical id, and performs a single-record delete.
 *
 * Behavior (handler-level, not wire-level):
 * - On success:
 *   - Performs delete via DbDeleter.
 *   - Ensures a DtoBag is present on ctx["bag"] (may be empty).
 *   - Sets handlerStatus="ok".
 *   - Does NOT build a wire payload; ControllerBase.finalize() is responsible
 *     for mapping ctx → HTTP response (status/body) using ctx["bag"] / ctx["error"].
 * - On error:
 *   - Sets handlerStatus="error".
 *   - Populates ctx["error"] (NvHandlerError) and ctx["status"].
 *
 * Assumptions:
 * - Canonical ids are UUIDv4 strings (validated via isValidUuidV4).
 * - Controller exposes a DtoRegistry via controller.getDtoRegistry().
 * - DtoRegistry implements dbCollectionNameByType(dtoType: string): string.
 * - Env configuration provides NV_MONGO_URI and NV_MONGO_DB (SvcEnv-driven).
 *
 * Notes (for shared use):
 * - No env-service–specific DTOs or modules are referenced.
 * - Safe to reuse in any service that:
 *   - Uses UUIDv4 ids, and
 *   - Follows the typed-route pattern with ctx["dtoType"] + DtoRegistry.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbDeleter } from "@nv/shared/dto/persistence/DbDeleter";
import { isValidUuidV4 } from "@nv/shared/utils/uuid";
import { DtoBag } from "@nv/shared/dto/DtoBag";

export class DbDeleteByIdHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Delete a single document by UUIDv4 id using typed routes and the DtoRegistry for collection resolution.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_start",
        handler: this.constructor.name,
        requestId,
      },
      "dbDeleteById enter"
    );

    // ---- Extract required params -------------------------------------------
    const params: any = this.safeCtxGet<any>("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.safeCtxGet<string>("dtoType") ?? "";

    if (!dtoType) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_dto_type",
        detail: "Missing required path parameter ':dtoType'.",
        stage: "params.dtoType",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            reason: "no_dtoType",
          },
        ],
        logMessage:
          "dbDeleteById — missing :dtoType for typed delete route (DELETE /api/:slug/v:version/:dtoType/delete/:id).",
        logLevel: "warn",
      });
      return;
    }

    if (!rawId) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_id",
        detail: "Missing required path parameter ':id'.",
        stage: "params.id",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            reason: "no_id",
          },
        ],
        logMessage:
          "dbDeleteById — missing :id for typed delete route (DELETE /api/:slug/v:version/:dtoType/delete/:id).",
        logLevel: "warn",
      });
      return;
    }

    if (!isValidUuidV4(rawId)) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_id_format",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        stage: "params.idFormat",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            id: rawId,
            expected: "uuidv4",
          },
        ],
        logMessage:
          "dbDeleteById — invalid id format; expected UUIDv4 for canonical DTO id.",
        logLevel: "warn",
      });
      return;
    }

    const id = rawId;

    // ---- Registry for collection resolution --------------------------------
    const registry = (this.controller as any).getDtoRegistry?.();

    if (!registry) {
      this.failWithError({
        httpStatus: 500,
        title: "delete_setup_missing",
        detail:
          "DTO Registry missing. Ops: ensure the App exposes a per-service DtoRegistry; controller must extend ControllerBase correctly.",
        stage: "config.registry",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasRegistry: !!registry,
          },
        ],
        logMessage:
          "dbDeleteById setup missing — controller.getDtoRegistry() returned null/undefined.",
        logLevel: "error",
      });
      return;
    }

    let collectionName = "";
    try {
      if (typeof registry.dbCollectionNameByType !== "function") {
        throw new Error("Registry missing dbCollectionNameByType()");
      }
      collectionName = registry.dbCollectionNameByType(dtoType);
      if (!collectionName || !collectionName.trim()) {
        throw new Error(`No collection mapped for dtoType="${dtoType}"`);
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "unknown_dto_type",
        detail:
          (err as Error)?.message ??
          `Unable to resolve collection for dtoType "${dtoType}".`,
        stage: "config.collectionFromDtoType",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          dtoType,
        },
        issues: [
          {
            dtoType,
          },
        ],
        rawError: err,
        logMessage:
          "dbDeleteById — failed to resolve collection from dtoType via DtoRegistry.",
        logLevel: "warn",
      });
      return;
    }

    // ---- Env / Mongo config via HandlerBase.getVar (SvcEnv-driven) ---------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

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
          collection: collectionName,
        },
        issues: [
          {
            mongoUriPresent: !!mongoUri,
            mongoDbPresent: !!mongoDb,
          },
        ],
        logMessage:
          "dbDeleteById aborted — Mongo env config missing (NV_MONGO_URI / NV_MONGO_DB).",
        logLevel: "error",
      });
      return;
    }

    // ---- External edge: DB delete (fine-grained try/catch) -----------------
    try {
      const deleter = new DbDeleter({
        mongoUri,
        mongoDb,
        collectionName,
      });

      const tgt = await deleter.targetInfo();
      this.log.debug(
        {
          event: "delete_target",
          collection: tgt.collectionName,
          id,
          dtoType,
          requestId,
        },
        "dbDeleteById will target collection"
      );

      const { deleted } = await deleter.deleteById(id);

      if (deleted === 0) {
        this.failWithError({
          httpStatus: 404,
          title: "not_found",
          detail: "No document matched the supplied id.",
          stage: "db.deleteById.notFound",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName,
          },
          issues: [
            {
              id,
              collection: collectionName,
            },
          ],
          logMessage:
            "dbDeleteById — deleteById completed but no document matched the supplied id.",
          logLevel: "warn",
        });
        return;
      }

      // ---- Success: ensure a DtoBag is present for finalize() --------------
      let bag = this.safeCtxGet<DtoBag<any>>("bag");
      if (!bag) {
        bag = new DtoBag<any>([]);
        this.ctx.set("bag", bag);
      }

      this.ctx.set("handlerStatus", "ok");

      this.log.info(
        {
          event: "delete_ok",
          id,
          dtoType,
          collection: collectionName,
          deleted,
          requestId,
        },
        "dbDeleteById succeeded"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_op_failed",
        detail:
          (err as Error)?.message ??
          "DbDeleter.deleteById() failed while attempting to delete a document by id.",
        stage: "db.deleteById",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          collection: collectionName,
        },
        issues: [
          {
            id,
            dtoType,
            collection: collectionName,
          },
        ],
        rawError: err,
        logMessage:
          "dbDeleteById failed — unexpected error during DbDeleter.deleteById().",
        logLevel: "error",
      });
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.constructor.name,
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "dbDeleteById exit"
    );
  }
}
