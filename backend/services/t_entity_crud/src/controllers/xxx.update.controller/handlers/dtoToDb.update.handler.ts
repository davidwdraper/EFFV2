// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/dtoToDb.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (Hydration & Failure Propagation)
 *
 * Purpose:
 * - Instantiate a DbWriter with the hydrated DTO and SvcEnvDto.
 * - Stash the writer into HandlerContext as "dbWriter". **No write here.**
 *
 * Inputs (ctx):
 * - "dto": XxxDto (from dtoFromJson.create.handler)
 * - "svcEnv": SvcEnvDto (seeded by ControllerBase from App)
 *
 * Outputs (ctx):
 * - "dbWriter": DbWriter<XxxDto>
 *
 * Conventions:
 * - This handler is single-purpose and relies on HandlerBase short-circuiting on prior failure.
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { DbWriter } from "@nv/shared/dto/persistence/DbWriter";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

export class DtoToDbUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dtoToDb handler enter");

    // DTO must be present from the prior handler
    const dto = this.ctx.get<XxxDto>("dto");
    if (!dto) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DTO_MISSING",
        message:
          "DTO not found in context. Ops: ensure dtoFromJson.update.handler runs first and sets ctx.set('dto', dto).",
        hint: "Verify handler order in xxx.update.controller.ts and that ControllerBase seeded 'body' correctly.",
      });
      this.log.debug(
        { event: "execute_error", reason: "dto_missing" },
        "DTO missing in context"
      );
      return;
    }

    // SvcEnv is the single source of DB connectivity (no factories, no globals)
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto not found in context. Ops: ensure ControllerBase seeds 'svcEnv' from App during context creation.",
        hint: "Expose a public accessor on App for env DTO (e.g., app.svcEnv or app.getEnv()).",
      });
      this.log.debug(
        { event: "execute_error", reason: "svcenv_missing" },
        "SvcEnv missing"
      );
      return;
    }

    // Construct writer with DTO + SvcEnv (no write() here)
    const writer = new DbWriter<XxxDto>({ dto, svcEnv });
    this.ctx.set("dbWriter", writer);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "writer_ready" },
      "DbWriter constructed & stored as 'dbWriter' (no write executed)"
    );
    this.log.debug({ event: "execute_exit" }, "dtoToDb handler exit");
  }
}
