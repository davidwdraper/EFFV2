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
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>; controller resolves collection)
 *
 * Purpose:
 * - DELETE /:typeKey/:id — delete a single record by canonical id, using a pre-resolved collection name.
 *
 * Contract:
 * - Controller MUST seed:
 *     ctx.set("delete.collectionName", <string>);
 * - Handler reads:
 *     params.id (canonical), svcEnv, delete.collectionName
 *
 * Behavior:
 * - 200 { ok:true, deleted:1, id } on success
 * - 404 problem+json if no document deleted
 * - 400 problem+json on missing/empty :id
 * - 500 problem+json on missing context or DB errors
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbDeleter } from "@nv/shared/dto/persistence/DbDeleter";

export class DbDeleteDeleteHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "dbDelete.delete enter");

    // Required context
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    const collectionName = this.ctx.get<string>("delete.collectionName");

    if (
      !svcEnv ||
      typeof collectionName !== "string" ||
      collectionName.trim() === ""
    ) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DELETE_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Missing svcEnv or delete.collectionName. Ops: ensure NV_MONGO_* in svcenv. Dev: controller must resolve typeKey → collection and seed ctx.",
        hint: "Controller should call registry.dbCollectionNameByType(typeKey) and set ctx.set('delete.collectionName', name).",
      });
      this.log.error(
        { event: "setup_missing", hasSvcEnv: !!svcEnv, collectionName },
        "Delete setup missing"
      );
      return;
    }

    // Canonical id
    const params: any = this.ctx.get("params") ?? {};
    const idRaw = typeof params.id === "string" ? params.id.trim() : "";

    if (!idRaw) {
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

    try {
      const deleter = new DbDeleter({ svcEnv, collectionName });

      // Introspection for parity with read/write logs
      const tgt = await deleter.targetInfo();
      this.log.debug(
        {
          event: "delete_target",
          collection: tgt.collectionName,
          id: idRaw,
        },
        "delete will target collection"
      );

      const { deleted } = await deleter.deleteById(idRaw);

      if (deleted === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: "No document matched the supplied id.",
          hint: "Verify the id or re-read before deleting.",
        });
        this.log.warn(
          { event: "delete_not_found", id: idRaw },
          "Delete: not found"
        );
        return;
      }

      // Success
      this.ctx.set("result", { ok: true, deleted: 1, id: idRaw });
      this.ctx.set("handlerStatus", "ok");
      this.log.info({ event: "delete_ok", id: idRaw }, "Delete succeeded");
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
