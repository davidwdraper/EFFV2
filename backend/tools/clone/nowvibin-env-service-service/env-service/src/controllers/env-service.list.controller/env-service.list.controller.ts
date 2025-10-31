// backend/services/env-service/src/controllers/env-service.list.controller/env-service.list.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture — per-route controllers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *
 * Purpose:
 * - Orchestrate GET /api/env-service/v1/list
 * - Pipeline: parse query → db read many → finalize
 *
 * Notes:
 * - No pagination yet (by design). We return the full filtered set.
 * - The DTO remains the only source of truth; serialization via toJson() (stamps meta).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";

import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { QueryListHandler } from "./handlers/query.list.handler";
import { DbReadListHandler } from "./handlers/dbRead.list.handler";

export class EnvServiceListController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed DTO ctor used by handlers
    ctx.set("list.dtoCtor", EnvServiceDto);

    const handlers = [
      new QueryListHandler(ctx), // builds "list.filter"
      new DbReadListHandler(ctx), // reader.readMany → ctx.result
    ];

    for (const h of handlers) await h.run();
    return super.finalize(ctx);
  }
}
