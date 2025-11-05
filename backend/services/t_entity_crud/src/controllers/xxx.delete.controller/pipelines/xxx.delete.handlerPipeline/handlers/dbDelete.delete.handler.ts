// backend/services/t_entity_crud/src/controllers/xxx.delete.controller/handlers/dbDelete.delete.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; adapter edge coercion)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0048 (Reader/Writer/Deleter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>; handler resolves collection via Registry)
 *
 * Purpose:
 * - DELETE /:typeKey/:id — delete a single record by canonical id, resolving
 *   the collection name from the DTO Registry using :typeKey.
 *
 * Behavior:
 * - 200 { ok:true, deleted:1, id } on success
 * - 404 problem+json if no document deleted
 * - 400 problem+json on missing/empty :id or :typeKey
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

    // Pull params
    const params: any = this.ctx.get("params") ?? {};
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const typeKey =
      typeof params.typeKey === "string" ? params.typeKey.trim() : "";

    if (!typeKey) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':typeKey'.",
        hint: "Call DELETE /api/xxx/v1/<DtoTypeKey>/<id>.",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_typeKey" },
        "Missing :typeKey"
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
        hint: "Call DELETE /api/xxx/v1/<DtoTypeKey>/<id>.",
      });
      this.log.warn({ event: "bad_request", reason: "no_id" }, "Missing :id");
      return;
    }

    // svcEnv + Registry via Controller (no ctx plumbing)
    const svcEnv = this.controller.getSvcEnv();
    const registry =
      this.controller.getDtoRegistry?.() ?? this.controller.getDtoRegistry?.();

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

    // Resolve collection from typeKey
    let collectionName = "";
    try {
      if (typeof registry.dbCollectionNameByType !== "function") {
        throw new Error("Registry missing dbCollectionNameByType()");
      }
      collectionName = registry.dbCollectionNameByType(typeKey);
      if (!collectionName || !collectionName.trim()) {
        throw new Error(`No collection mapped for typeKey="${typeKey}"`);
      }
    } catch (e: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "UNKNOWN_TYPE_KEY",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve collection for typeKey "${typeKey}".`,
        hint: "Verify the DtoRegistry contains this type key and exposes a collection.",
      });
      this.log.warn(
        { event: "type_key_resolve_failed", typeKey, err: e?.message },
        "Failed to resolve collection from typeKey"
      );
      return;
    }

    try {
      const deleter = new DbDeleter({ svcEnv, collectionName });

      // Introspection for parity with read/write logs
      const tgt = await deleter.targetInfo();
      this.log.debug(
        {
          event: "delete_target",
          collection: tgt.collectionName,
          id,
          typeKey,
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
