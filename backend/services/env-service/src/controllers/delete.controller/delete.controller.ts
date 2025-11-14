// backend/services/env-service/src/controllers/delete.controller/delete.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>) — generalized: :dtoType on every route
 *
 * Purpose:
 * - Orchestrate DELETE /api/env-service/v1/:dtoType/delete/:id
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as EnvServiceDeletePipeline from "./pipelines/delete.pipeline";
// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoDeletePipeline from "./pipelines/myNewDto.delete.handlerPipeline";

export class EnvServiceDeleteController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async delete(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "delete");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "delete",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting delete pipeline"
    );

    switch (dtoType) {
      case "env-service": {
        const steps = EnvServiceDeletePipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   const steps = MyNewDtoDeletePipeline.getSteps(ctx, this);
      //   await this.runPipeline(ctx, steps, { requireRegistry: true });
      //   break;
      // }

      default: {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No delete pipeline for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });
        this.log.warn(
          {
            event: "pipeline_missing",
            op: "delete",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no delete pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
