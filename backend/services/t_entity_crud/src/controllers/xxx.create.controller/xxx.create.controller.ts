// backend/services/t_entity_crud/src/controllers/xxx.create.controller/xxx.create.controller.ts
/**
 * Purpose:
 * - Orchestrate PUT /api/xxx/v1/create (mounted at /create relative to base).
 * - No business logic; ends with super.finalize(ctx).
 * - Index ensuring happens at app boot (not here).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { DtoFromJsonCreateHandler } from "./handlers/dtoFromJson.create.handler";
import { DtoToDbCreateHandler } from "./handlers/dtoToDb.create.handler";
import { DbWriteCreateHandler } from "./handlers/dbWrite.create.handler";

export class XxxCreateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    const handlers = [
      new DtoFromJsonCreateHandler(ctx),
      new DtoToDbCreateHandler(ctx), // provides dbWriter (no write here)
      new DbWriteCreateHandler(ctx), // does the actual write
    ];

    for (const h of handlers) await h.run();

    return super.finalize(ctx);
  }
}
