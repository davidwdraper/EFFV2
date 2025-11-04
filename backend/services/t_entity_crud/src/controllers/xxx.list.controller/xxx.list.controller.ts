// backend/services/t_entity_crud/src/controllers/xxx.list.controller/xxx.list.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *
 * Purpose:
 * - Orchestrate GET /api/xxx/v1/list (template: single DTO).
 * - Pipeline: parse query → db read batch → finalize.
 *
 * Notes:
 * - Cursor pagination supported via ?limit=&cursor=.
 * - DTO remains the single source of truth; serialization via toJson() (stamps meta).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { QueryListHandler } from "./handlers/query.list.handler";
import { DbReadListHandler } from "./handlers/dbRead.list.handler";

export class XxxListController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed DTO ctor used by handlers (template service: single DTO).
    ctx.set("list.dtoCtor", XxxDto);

    await this.runPipeline(
      ctx,
      [new QueryListHandler(ctx), new DbReadListHandler(ctx)],
      { requireRegistry: false }
    );

    return super.finalize(ctx);
  }
}
