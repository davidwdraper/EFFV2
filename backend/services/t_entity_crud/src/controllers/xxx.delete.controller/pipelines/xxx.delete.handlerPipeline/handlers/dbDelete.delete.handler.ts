// backend/services/t_entity_crud/src/controllers/xxx.delete.controller/handlers/dbDelete.delete.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0040 (DTO-Only Persistence; adapter edge coercion)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0048 (Reader/Writer/Deleter contracts)
 * - ADR-0050 (Wire Bag Envelope — canonical id="id")
 * - ADR-0056 (Typed routes use :dtoType; handler resolves collection via Registry)
 * - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *
 * Purpose:
 * - DELETE /:dtoType/delete/:id — delete a single record by canonical id,
 *   resolving the collection name from the DTO Registry using :dtoType.
 *
 * Behavior:
 * - 200 { ok:true, deleted:1, id } on success
 * - 404 problem+json if no document deleted
 * - 400 problem+json on missing/empty :id or :dtoType
 * - 500 problem+json on missing env/registry or DB errors
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbDeleter } from "@nv/shared/dto/persistence/DbDeleter";

export class DbDeleteDeleteHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "dbDelete.delete enter");

    // Pull required params
    const params: any = this.ctx.get("params") ?? {};
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const dtoType = this.ctx.get<string>("dtoType");

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
        "Missing :dtoType"
      );
      return;
    }

    if (!id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':id'.",
        hint: "Call DELETE /api/:slug/v:version/:dtoType/delete/:id",
      });
      this.log.warn({ event: "bad_request", reason: "no_id" }, "Missing :id");
      return;
    }

    // svcEnv + Registry via Controller (no ctx plumbing)
    const svcEnv = this.controller.getSvcEnv?.();
    const registry = this.controller.getDtoRegistry?.();

    if (!svcEnv || !registry) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DELETE_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Missing svcEnv or Registry. Ops: ensure App exposes svcEnv and DTO Registry; controller must extend ControllerBase correctly.",
        hint: "AppBase owns env DTO and per-service Registry; expose via getters.",
      });
      this.log.error(
        {
          event: "setup_missing",
          hasSvcEnv: !!svcEnv,
          hasRegistry: !!registry,
        },
        "Delete setup missing"
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
        "Failed to resolve collection from dtoType"
      );
      return;
    }

    // Derive Mongo connection info from svcEnv (ADR-0044; tolerant to shape)
    const svcEnvAny: any = svcEnv;
    const vars = svcEnvAny?.vars ?? svcEnvAny ?? {};
    const mongoUri: string | undefined =
      vars.NV_MONGO_URI ?? vars["NV_MONGO_URI"];
    const mongoDb: string | undefined = vars.NV_MONGO_DB ?? vars["NV_MONGO_DB"];

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service for NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv: !!svcEnv,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
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
        "delete will target collection"
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
        hint: "Check env-service NV_MONGO_URI/NV_MONGO_DB; confirm collection name from Registry; verify network/auth and Mongo health.",
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
