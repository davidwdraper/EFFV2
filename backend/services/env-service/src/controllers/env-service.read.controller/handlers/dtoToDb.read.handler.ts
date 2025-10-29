// backend/services/env-service/src/controllers/env-service.read.controller/handlers/dtoToDb.read.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Instantiate a DbReader<TDto> using SvcEnv from ctx.
 * - Store it under ctx key (default "dbReader"). **No read here.**
 *
 * Context Inputs:
 * - "svcEnv": SvcEnvDto                         (required)
 * - "read.dtoCtor": DTO class                   (required)
 * - "read.dbReader.ctxKey": string              (optional, default "dbReader")
 * - "read.validateReads": boolean               (optional, default false)
 *
 * Context Outputs:
 * - "<ctxKey>": DbReader<TDto>
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";

export class DtoToDbReadHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dtoToDb.read handler enter");

    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto not found in context. Ops: ensure ControllerBase seeds 'svcEnv' from App during context creation.",
        hint: "Expose a public accessor on App for env DTO (e.g., app.svcEnv).",
      });
      this.log.debug(
        { event: "execute_error", reason: "svcenv_missing" },
        "SvcEnv missing"
      );
      return;
    }

    const dtoCtor = this.ctx.get<any>("read.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromJson !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DTO_CTOR_MISSING",
        message:
          "DTO constructor not provided in ctx as 'read.dtoCtor' or missing static fromJson().",
        hint: "Seed ctx.set('read.dtoCtor', XxxDto) in the controller before running this handler.",
      });
      this.log.debug(
        { event: "execute_error", reason: "dtoCtor_missing" },
        "DTO ctor missing"
      );
      return;
    }

    const ctxKey = this.ctx.get<string>("read.dbReader.ctxKey") ?? "dbReader";
    const validateReads = this.ctx.get<boolean>("read.validateReads") ?? false;

    const reader = new DbReader<any>({
      dtoCtor,
      svcEnv,
      validateReads,
    });

    this.ctx.set(ctxKey, reader);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "reader_ready", ctxKey, validateReads },
      "DbReader constructed & stored (no read executed)"
    );
    this.log.debug({ event: "execute_exit" }, "dtoToDb.read handler exit");
  }
}
