// backend/services/env-service/src/controllers/env-service.update.controller/handlers/loadExisting.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Build DbReader<XxxDto> and load existing doc by :xxxId.
 * - Hydrate with { validate:false } (trust our own writes).
 *
 * Inputs:
 * - params.xxxId (required)
 * - "svcEnv": SvcEnvDto (required)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs:
 * - "existing": XxxDto
 * - "dbReader": DbReader<XxxDto>
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";

export class LoadExistingUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "loadExisting.update enter");

    // --- Path param (typed) --------------------------------------------------
    const params = (this.ctx.get("params") as Record<string, unknown>) ?? {};
    const raw = (
      typeof params.xxxId === "string"
        ? params.xxxId
        : String(params["xxxId"] ?? "")
    ).trim();

    if (!raw) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "MISSING_ID",
        message: "Path param :xxxId is required.",
        hint: "PATCH /api/env-service/v1/<xxxId> with JSON body of fields to update.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "missing_id" },
        "loadExisting.update exit"
      );
      return;
    }

    // --- Required context (svcEnv + dtoCtor) --------------------------------
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto not found in context. Ops: ensure ControllerBase seeds 'svcEnv' from App during context creation.",
        hint: "Call setLoggerEnv(envDto) before AppBase and verify ControllerBase.makeContext() sets svcEnv.",
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
        hint: "Seed ctx.set('update.dtoCtor', XxxDto) in the controller before running this handler.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "dtoCtor_missing" },
        "loadExisting.update exit"
      );
      return;
    }

    // --- Build reader and fetch existing -----------------------------------
    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;
    const reader = new DbReader<any>({ dtoCtor, svcEnv, validateReads });
    this.ctx.set("dbReader", reader);

    // Use helper that coerces string → ObjectId as needed
    const existing = await reader.readById(raw);
    if (!existing) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 404);
      this.ctx.set("error", {
        code: "NOT_FOUND",
        message: "No document found for supplied :xxxId.",
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
