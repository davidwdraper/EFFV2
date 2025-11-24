// backend/services/shared/src/http/handlers/dbDeleteById.handler.ts
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
 *   - Sets handlerStatus="ok".
 *   - Does NOT build a wire payload; ControllerBase.finalize() is responsible
 *     for mapping ctx → HTTP response (status/body).
 * - On error:
 *   - Sets handlerStatus="error".
 *   - Sets response.status and response.body (problem+json shape).
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

export class DbDeleteByIdHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "dbDeleteById enter");

    const requestId = this.ctx.get("requestId");

    // ---- Extract required params -------------------------------------------
    const params: any = this.ctx.get("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.ctx.get<string>("dtoType") ?? "";

    if (!dtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        hint: "Call DELETE /api/:slug/v:version/:dtoType/delete/:id",
        requestId,
      });
      this.log.warn(
        { event: "bad_request", reason: "no_dtoType" },
        "dbDeleteById — missing :dtoType"
      );
      return;
    }

    if (!rawId) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':id'.",
        hint: "Call DELETE /api/:slug/v:version/:dtoType/delete/:id",
        requestId,
      });
      this.log.warn(
        { event: "bad_request", reason: "no_id" },
        "dbDeleteById — missing :id"
      );
      return;
    }

    if (!isValidUuidV4(rawId)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_ID_FORMAT",
        title: "Bad Request",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        hint: "Use a UUIDv4 for the canonical DTO id.",
        requestId,
      });
      this.log.warn(
        { event: "bad_request", reason: "invalid_id_format", id: rawId },
        "dbDeleteById — invalid id format"
      );
      return;
    }

    const id = rawId;

    // ---- Registry for collection resolution --------------------------------
    const registry = this.controller.getDtoRegistry?.();

    if (!registry) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DELETE_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "DTO Registry missing. Ops: ensure the App exposes a per-service DtoRegistry; controller must extend ControllerBase correctly.",
        hint: "AppBase owns the DtoRegistry; expose via getDtoRegistry().",
        requestId,
      });
      this.log.error(
        {
          event: "setup_missing",
          hasRegistry: !!registry,
        },
        "dbDeleteById setup missing — registry not available"
      );
      return;
    }

    // Resolve collection from dtoType
    let collectionName = "";
    try {
      if (typeof registry.dbCollectionNameByType !== "function") {
        throw new Error("Registry missing dbCollectionNameByType()");
      }
      collectionName = registry.dbCollectionNameByType(dtoType);
      if (!collectionName || !collectionName.trim()) {
        throw new Error(`No collection mapped for dtoType="${dtoType}"`);
      }
    } catch (e: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "UNKNOWN_DTO_TYPE",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve collection for dtoType "${dtoType}".`,
        hint: "Verify the DtoRegistry contains this dtoType and exposes a collection.",
        requestId,
      });
      this.log.warn(
        { event: "dto_type_resolve_failed", dtoType, err: e?.message },
        "dbDeleteById — failed to resolve collection from dtoType"
      );
      return;
    }

    // ---- Env / Mongo config via HandlerBase.getVar (SvcEnv-driven) ---------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
        requestId,
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.constructor.name,
        },
        "dbDeleteById aborted — Mongo env config missing"
      );
      return;
    }

    try {
      const deleter = new DbDeleter({
        mongoUri,
        mongoDb,
        collectionName,
      });

      // Introspection for parity with read/write logs
      const tgt = await deleter.targetInfo();
      this.log.debug(
        {
          event: "delete_target",
          collection: tgt.collectionName,
          id,
          dtoType,
        },
        "dbDeleteById will target collection"
      );

      const { deleted } = await deleter.deleteById(id);

      if (deleted === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 404);
        this.ctx.set("response.body", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: "No document matched the supplied id.",
          hint: "Verify the id or re-read before deleting.",
          requestId,
        });
        this.log.warn(
          { event: "delete_not_found", id },
          "dbDeleteById: not found"
        );
        return;
      }

      // Success: do NOT build a wire payload here.
      // Leave handlerStatus="ok" and let ControllerBase.finalize() decide
      // how to represent the outcome on the wire (e.g., 200/204, body shape).
      this.ctx.set("handlerStatus", "ok");
      this.log.info({ event: "delete_ok", id }, "dbDeleteById succeeded");
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DB_OP_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        hint: "Check svcenv NV_MONGO_URI/NV_MONGO_DB; confirm collection name from Registry; verify network/auth and Mongo health.",
        requestId,
      });
      this.log.error(
        { event: "delete_error", err: err?.message },
        "dbDeleteById failed"
      );
    } finally {
      this.log.debug({ event: "execute_end" }, "dbDeleteById exit");
    }
  }
}
