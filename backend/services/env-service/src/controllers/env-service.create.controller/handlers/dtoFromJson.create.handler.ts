// backend/services/env-service/src/controllers/env-service.create.controller/handlers/dtoFromJson.create.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (Hydration + Failure Propagation)
 *
 * Purpose:
 * - Hydrate and validate the EnvService DTO from inbound payload.
 * - On success: place DTO into HandlerContext under "dto".
 * - On failure: set handlerStatus="error", status=400, and an Ops-friendly error.
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class DtoFromJsonCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dtoFromJson handler enter");

    const body = this.ctx.get<unknown>("body");
    try {
      const dto = EnvServiceDto.fromJson(body, { validate: true });
      this.ctx.set("dto", dto);
      this.ctx.set("handlerStatus", "ok");
      this.log.debug({ event: "dto_hydrated" }, "DTO hydrated & validated");
    } catch (err) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "DTO_VALIDATION",
        message:
          err instanceof Error
            ? err.message
            : "Unknown error during DTO validation",
        issues: (err as any)?.issues,
      });
      this.log.debug(
        {
          event: "execute_error",
          error: (err as Error)?.message ?? String(err),
        },
        "DTO validation failed"
      );
    }

    this.log.debug({ event: "execute_exit" }, "dtoFromJson handler exit");
  }
}
