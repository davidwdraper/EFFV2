// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/loadExisting.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 *
 * Purpose:
 * - Build DbReader<XxxDto> and load existing doc by canonical ctx["id"].
 * - Hydrate with { validate:false } (trust our own writes).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :xxxId)
 * - "svcEnv": SvcEnvDto (required)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existing": XxxDto
 * - "dbReader": DbReader<XxxDto>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";

export class LoadExistingUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "loadExisting.update enter");

    const raw = String(this.ctx.get("id") ?? "").trim();
    if (!raw) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "MISSING_ID",
        message: "Path param :id is required.",
        hint: "PATCH /api/xxx/v1/<id> with JSON body of fields to update.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "missing_id" },
        "loadExisting.update exit"
      );
      return;
    }

    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto missing. Ops: ControllerBase must seed 'svcEnv' from App.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "svcenv_missing" },
        "loadExisting.update exit"
      );
      return;
    }

    const dtoCtor = this.ctx.get<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromJson !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DTO_CTOR_MISSING",
        message:
          "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromJson().",
      });
      this.log.debug(
        { event: "execute_exit", reason: "dtoCtor_missing" },
        "loadExisting.update exit"
      );
      return;
    }

    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;
    const reader = new DbReader<any>({ dtoCtor, svcEnv, validateReads });
    this.ctx.set("dbReader", reader);

    const existing = await reader.readById(raw);
    if (!existing) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 404);
      this.ctx.set("error", {
        code: "NOT_FOUND",
        message: "No document found for supplied :id.",
        hint: "Confirm the id from create/read response; ensure same collection.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "not_found", id: raw },
        "loadExisting.update exit"
      );
      return;
    }

    this.ctx.set("existing", existing);
    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      { event: "execute_exit", id: raw },
      "loadExisting.update exit"
    );
  }
}
