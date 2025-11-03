// backend/services/t_entity_crud/src/controllers/xxx.delete.controller/xxx.delete.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture — per-route controllers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Orchestrate DELETE /api/xxx/v1/delete/:xxxId
 * - Zero business logic: seed ctx, run handler, finalize.
 *
 * Invariants:
 * - Controllers seed all handler prerequisites via HandlerContext.
 * - Handlers operate strictly in DTO-space; no DB shapes leak here.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { DbDeleteDeleteHandler } from "./handlers/dbDelete.delete.handler";
// DTO ctor is required so the handler can resolve the correct collection name.
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

export class XxxDeleteController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async delete(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed the DTO ctor for delete handlers (symmetry with read controller).
    // Handlers will use dtoCtor.dbCollectionName() to select the correct collection.
    ctx.set("delete.dtoCtor", XxxDto);

    // Single-purpose handler executes the delete and sets result/status.
    const handler = new DbDeleteDeleteHandler(ctx);
    await handler.run();

    return super.finalize(ctx);
  }
}
