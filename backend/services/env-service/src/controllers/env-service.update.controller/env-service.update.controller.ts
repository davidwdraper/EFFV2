// backend/services/env-service/src/controllers/env-service.update.controller/env-service.update.controller.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (Finalize mapping)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Orchestrate PATCH /api/env-service/v1/:xxxId
 * - Pipeline: load existing → apply patch → build DbWriter → update
 */
import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";

import { EnvDto } from "@nv/shared/dto/Env.dto";
import { LoadExistingUpdateHandler } from "./handlers/loadExisting.update.handler";
import { ApplyPatchUpdateHandler } from "./handlers/applyPatch.update.handler";
import { DtoToDbUpdateHandler } from "./handlers/dtoToDb.update.handler";
import { DbWriteUpdateHandler } from "./handlers/dbWrite.update.handler";

export class EnvServiceUpdateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async patch(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed DTO ctor for handlers
    ctx.set("update.dtoCtor", EnvDto);

    const handlers = [
      new LoadExistingUpdateHandler(ctx), // reads by :xxxId → ctx["existing"]
      new ApplyPatchUpdateHandler(ctx), // merges req.body → EnvDto → ctx["updated"]
      new DtoToDbUpdateHandler(ctx), // builds DbWriter({ dto, svcEnv }) → ctx["dbWriter"]
      new DbWriteUpdateHandler(ctx), // calls writer.update() → { ok:true, id }
    ];

    for (const h of handlers) await h.run();
    return super.finalize(ctx);
  }
}
