// backend/services/t_entity_crud/src/controllers/xxx.delete.controller/handlers/dbDelete.delete.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence; persistence adapters)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Delete a single document by id for DELETE /delete/:xxxId
 * - No DTO hydration required; operates at persistence boundary.
 *
 * Behavior:
 * - Success: 200 { ok: true, deleted: 1, id: "<id>" }
 * - Not found: 404 problem+json
 * - Bad input: 400 problem+json
 * - Unexpected: 500 problem+json
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { getMongoCollectionFromSvcEnv } from "@nv/shared/dto/persistence/adapters/mongo/connectFromSvcEnv";
import { ObjectId } from "mongodb";

function maybeObjectId(id: string): string | ObjectId {
  const hex24 = /^[0-9a-fA-F]{24}$/;
  return hex24.test(id) ? new ObjectId(id) : id;
}

export class DbDeleteDeleteHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dbDelete.delete enter");

    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto missing from context; cannot resolve Mongo collection.",
        hint: "Ensure ControllerBase seeds svcEnv from AppBase; verify ADR-0044 accessors.",
      });
      this.log.error({ event: "svcenv_missing" }, "SvcEnv missing");
      return;
    }

    const params: any = this.ctx.get("params") ?? {};
    const idRaw = typeof params.xxxId === "string" ? params.xxxId.trim() : "";
    if (!idRaw) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAD_REQUEST",
        message: "Missing required path parameter ':xxxId'.",
        hint: "Call DELETE /api/xxx/v1/delete/<_id>. If your _id is a Mongo ObjectId, pass the 24-hex value.",
      });
      this.log.warn(
        { event: "bad_request", reason: "no_id" },
        "Missing :xxxId"
      );
      return;
    }

    try {
      const col = await getMongoCollectionFromSvcEnv(svcEnv);
      const filter = { _id: maybeObjectId(idRaw) };

      const r = await col.deleteOne(filter);
      if ((r?.deletedCount ?? 0) === 0) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          message: "No document matched the supplied id.",
          hint: "Verify the id exists. If your collection stores ObjectId, ensure you pass a 24-hex string.",
        });
        this.log.warn(
          { event: "delete_not_found", id: idRaw },
          "Delete: document not found"
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
        message: "Delete operation failed at persistence boundary.",
        hint: "Check Mongo connectivity/env (NV_MONGO_*), and inspect server logs for the underlying error.",
        detail: err?.message ?? String(err),
      });
      this.log.error(
        { event: "delete_error", err: err?.message },
        "Delete failed"
      );
    } finally {
      this.log.debug({ event: "execute_exit" }, "dbDelete.delete exit");
    }
  }
}
