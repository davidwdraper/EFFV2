// backend/services/env-service/src/controllers/delete.controller/pipelines/delete.pipeline/handlers/delete.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; adapter edge coercion)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0048 (Reader/Writer/Deleter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire id="_id")
 *   - ADR-0056 (Typed routes use :dtoType; handler resolves collection via Registry)
 *
 * Purpose:
 * - DELETE /:dtoType/delete/:id — delete a single record by canonical id,
 *   resolving the collection name from the DTO Registry using :dtoType.
 *
 * Behavior:
 * - 200 { ok:true, deleted:1, id } on success
 * - 404 problem+json if no document deleted
 * - 400 problem+json on missing/empty/invalid :id or :dtoType
 * - 500 problem+json on missing env/registry or DB errors
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbDeleter } from "@nv/shared/dto/persistence/DbDeleter";
import { isValidUuidV4 } from "@nv/shared/utils/uuid";

export class DbDeleteDeleteHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "dbDelete.delete enter");

    // ---- Extract required params -------------------------------------------
    const params: any = this.ctx.get("params") ?? {};
    const rawId = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.ctx.get<string>("dtoType") ?? "";

    if (!dtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        hint: "Call DELETE /api/:slug/v:version/:dtoType/delete/:id",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_dtoType" },
        "Delete — missing :dtoType"
      );
      return;
    }

    if (!rawId) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':id'.",
        hint: "Call DELETE /api/:slug/v:version/:dtoType/delete/:id",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_id" },
        "Delete — missing :id"
      );
      return;
    }

    if (!isValidUuidV4(rawId)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST_ID_FORMAT",
        title: "Bad Request",
        detail: `Invalid id format '${rawId}'. Expected a UUIDv4 string.`,
        hint: "Use a UUIDv4 for the canonical DTO id.",
      });
      this.log.warn(
        { event: "bad_request", reason: "invalid_id_format", id: rawId },
        "Delete — invalid id format"
      );
      return;
    }

    const id = rawId;

    // ---- Registry for collection resolution --------------------------------
    const registry = this.controller.getDtoRegistry?.();

    if (!registry) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DELETE_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "DTO Registry missing. Ops: ensure App exposes a per-service DtoRegistry; controller must extend ControllerBase correctly.",
        hint: "AppBase owns the DtoRegistry; expose via getDtoRegistry().",
      });
      this.log.error(
        {
          event: "setup_missing",
          hasRegistry: !!registry,
        },
        "Delete setup missing — registry not available"
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
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "UNKNOWN_DTO_TYPE",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve collection for dtoType "${dtoType}".`,
        hint: "Verify the DtoRegistry contains this dtoType and exposes a collection.",
      });
      this.log.warn(
        { event: "dto_type_resolve_failed", dtoType, err: e?.message },
        "Delete — failed to resolve collection from dtoType"
      );
      return;
    }

    // ---- Env / Mongo config via HandlerBase.getVar (SvcEnv-driven) ---------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.constructor.name,
        },
        "Delete aborted — Mongo env config missing"
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
        "Delete will target collection"
      );

      const { deleted } = await deleter.deleteById(id);

      if (deleted === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: "No document matched the supplied id.",
          hint: "Verify the id or re-read before deleting.",
        });
        this.log.warn({ event: "delete_not_found", id }, "Delete: not found");
        return;
      }

      // Success
      this.ctx.set("result", { ok: true, deleted: 1, id });
      this.ctx.set("handlerStatus", "ok");
      this.log.info({ event: "delete_ok", id }, "Delete succeeded");
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DB_OP_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        hint: "Check svcenv NV_MONGO_URI/NV_MONGO_DB; confirm collection name from Registry; verify network/auth and Mongo health.",
      });
      this.log.error(
        { event: "delete_error", err: err?.message },
        "Delete failed"
      );
    } finally {
      this.log.debug({ event: "execute_end" }, "dbDelete.delete exit");
    }
  }
}
