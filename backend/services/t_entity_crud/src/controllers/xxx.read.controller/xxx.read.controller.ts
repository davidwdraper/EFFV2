// backend/services/t_entity_crud/src/controllers/xxx.read.controller/xxx.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture)
 *   - ADR-0042 (HandlerContext Bus)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Orchestrate GET /api/xxx/v1/read (mounted at /read).
 * - Zero business logic: seed ctx, run handlers, finalize.
 *
 * Notes:
 * - All optional handler knobs are seeded into ctx to avoid param churn.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";

import { DtoToDbReadHandler } from "./handlers/dtoToDb.read.handler";
import { DbReadGetHandler } from "./handlers/dbRead.get.handler";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

export class XxxReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed handler options into ctx (no ctor args to handlers)
    ctx.set("read.dtoCtor", XxxDto); // required
    // Optional overrides (defaults used if not set):
    // ctx.set("read.dbReader.ctxKey", "dbReader");
    // ctx.set("read.validateReads", false);     // trust our own writes by default

    const handlers = [
      new DtoToDbReadHandler(ctx), // builds DbReader and sets ctx["dbReader"]
      new DbReadGetHandler(ctx), // executes the read (by id or filter)
    ];

    for (const h of handlers) await h.run();

    return super.finalize(ctx);
  }
}
