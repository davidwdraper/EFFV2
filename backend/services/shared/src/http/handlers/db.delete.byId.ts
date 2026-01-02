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
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
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
 *   - Does NOT build a wire payload; ControllerBase.finalize() maps ctx → HTTP.
 * - On error:
 *   - Uses failWithError() (sets ctx["error"] + ctx["status"] rails).
 *
 * Assumptions:
 * - Canonical ids are UUIDv4 strings (validated via isValidUuidV4).
 * - Controller exposes a DtoRegistry via controller.getDtoRegistry().
 * - DtoRegistry implements dbCollectionNameByType(dtoType: string): string.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbDeleter } from "../../dto/persistence/dbDeleter/DbDeleter";
import { isValidUuidV4 } from "../../utils/uuid";
import { DtoBag } from "../../dto/DtoBag";

export class DbDeleteByIdHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.delete.byId";
  }

  protected handlerPurpose(): string {
    return "Delete a single document by UUIDv4 id using typed routes and the DtoRegistry for collection resolution.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_start",
        handler: this.getHandlerName(),
        requestId,
      },
      "db.delete.byId enter"
    );

    // ---- Extract required params -------------------------------------------
    const params = this.safeCtxGet<any>("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.safeCtxGet<string>("dtoType") ?? "";

    if (!dtoType) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_dto_type",
        detail: "Missing required path parameter ':dtoType'.",
        stage: "db.delete.byId:params.dtoType",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ reason: "no_dtoType" }],
        logMessage: "db.delete.byId: missing :dtoType for typed delete route.",
        logLevel: "warn",
      });
      return;
    }

    if (!rawId) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_id",
        detail: "Missing required path parameter ':id'.",
        stage: "db.delete.byId:params.id",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ reason: "no_id" }],
        logMessage: "db.delete.byId: missing :id for typed delete route.",
        logLevel: "warn",
      });
      return;
    }

    if (!isValidUuidV4(rawId)) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_id_format",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        stage: "db.delete.byId:params.idFormat",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ id: rawId, expected: "uuidv4" }],
        logMessage: "db.delete.byId: invalid id format; expected UUIDv4.",
        logLevel: "warn",
      });
      return;
    }

    const id = rawId;

    // ---- Registry for collection resolution --------------------------------
    const registry = this.controller.getDtoRegistry();

    let collectionName: string;
    try {
      collectionName = registry.dbCollectionNameByType(dtoType);
      if (!collectionName || !collectionName.trim()) {
        throw new Error(`No collection mapped for dtoType="${dtoType}"`);
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "unknown_dto_type",
        detail:
          err instanceof Error
            ? err.message
            : `Unable to resolve collection for dtoType "${dtoType}".`,
        stage: "db.delete.byId:config.collectionFromDtoType",
        requestId,
        origin: { file: __filename, method: "execute", dtoType },
        issues: [{ dtoType }],
        rawError: err,
        logMessage:
          "db.delete.byId: failed to resolve collection from dtoType via DtoRegistry.",
        logLevel: "warn",
      });
      return;
    }

    // ---- DB config comes from runtime rails --------------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // ---- External edge: DB delete ------------------------------------------
    try {
      const deleter = new DbDeleter({ mongoUri, mongoDb, collectionName });

      const { deleted } = await deleter.deleteById(id);

      if (deleted === 0) {
        this.failWithError({
          httpStatus: 404,
          title: "not_found",
          detail: "No document matched the supplied id.",
          stage: "db.delete.byId:db.notFound",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName,
          },
          issues: [{ id, collection: collectionName }],
          logMessage: "db.delete.byId: no document matched supplied id.",
          logLevel: "warn",
        });
        return;
      }

      // Success: ensure a DtoBag is present for finalize().
      const bag = this.safeCtxGet<DtoBag<any>>("bag") ?? new DtoBag<any>([]);
      this.ctx.set("bag", bag);

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
        "db.delete.byId succeeded"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_op_failed",
        detail:
          err instanceof Error
            ? err.message
            : "DbDeleter.deleteById() failed while attempting to delete a document by id.",
        stage: "db.delete.byId:db.deleteById",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          collection: collectionName,
        },
        issues: [{ id, dtoType, collection: collectionName }],
        rawError: err,
        logMessage: "db.delete.byId: unexpected error during deleteById().",
        logLevel: "error",
      });
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.getHandlerName(),
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "db.delete.byId exit"
    );
  }
}
