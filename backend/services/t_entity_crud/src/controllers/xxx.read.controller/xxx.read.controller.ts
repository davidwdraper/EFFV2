// backend/services/t_entity_crud/src/controllers/xxx.read.controller/xxx.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Controller & Handler Architecture — per-route controllers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Orchestrate GET /api/xxx/v1/read  (router mounts at /read)
 * - Zero business logic: seed ctx → run handlers → finalize.
 *
 * Behavior:
 * - Uses DbReader via handler to read exactly one document:
 *   - If an id is provided (path or query), prefer readById(id)
 *   - Otherwise, optional single-record filter read (handler-owned)
 *
 * Notes:
 * - DTO-only inside the service; JSON only at the edge (finalize).
 * - Handlers remain unchanged: DtoToDbReadHandler → DbReadGetHandler.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";

import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { DtoToDbReadHandler } from "./handlers/dtoToDb.read.handler";
import { DbReadGetHandler } from "./handlers/dbRead.get.handler";

export class XxxReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Required: DTO ctor for the handlers/DbReader
    ctx.set("read.dtoCtor", XxxDto);

    // Optional knobs (handlers may default these if unset)
    // ctx.set("read.dbReader.ctxKey", "dbReader");
    // ctx.set("read.validateReads", false); // trust our own writes by default

    const pipeline = [
      new DtoToDbReadHandler(ctx), // builds DbReader and stores it in ctx (e.g., "dbReader")
      new DbReadGetHandler(ctx), // executes the read: id → readById; else optional filter → readOne
    ];

    for (const h of pipeline) await h.run();
    return super.finalize(ctx);
  }
}
