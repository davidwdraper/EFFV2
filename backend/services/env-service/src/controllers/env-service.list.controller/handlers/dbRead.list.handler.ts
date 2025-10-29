// backend/services/env-service/src/controllers/env-service.list.controller/handlers/dbRead.list.handler.ts
/**
 * Docs:
 * - ADR-0040/0041/0042
 *
 * Purpose:
 * - Use DbReader<XxxDto> to fetch the full filtered set (no pagination for now).
 *
 * Inputs (ctx):
 * - "svcEnv": SvcEnvDto
 * - "list.dtoCtor": XxxDto constructor
 * - "list.filter": Record<string, unknown>
 *
 * Outputs (ctx):
 * - "result": { ok: true, docs: Array<unknown> }
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    const dtoCtor = this.ctx.get<any>("list.dtoCtor");

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "LIST_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (svcEnv or dtoCtor). Ops: verify ControllerBase.makeContext() and controller seeding.",
      });
      return;
    }

    const filter =
      (this.ctx.get("list.filter") as Record<string, unknown>) ?? {};

    // No pagination yet: fetch “all” (temporary high cap to avoid accidental explosions).
    const TEMP_HIGH_CAP = 100_000;

    const reader = new DbReader<any>({ dtoCtor, svcEnv, validateReads: false });
    const dtos = await reader.readMany(filter, TEMP_HIGH_CAP);

    // Single-exit serialization (DTO.toJson stamps meta).
    const docs = dtos.map((d: any) => d.toJson());
    this.ctx.set("result", { ok: true, docs });
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "list_complete", count: docs.length },
      "list read complete"
    );
  }
}
