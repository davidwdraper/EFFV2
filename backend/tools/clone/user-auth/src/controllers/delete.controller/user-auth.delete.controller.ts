// backend/services/user-auth/src/controllers/user-auth.delete.controller/user-auth.delete.controller.ts
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
 * - Orchestrate DELETE /api/user-auth/v1/:dtoType/delete/:id
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as UserAuthDeletePipeline from "./pipelines/delete.handlerPipeline";

export class UserAuthDeleteController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async delete(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;
    const ctx: HandlerContext = this.makeContext(req, res);

    // Seed op & dtoType; params already include :id from express
    ctx.set("dtoKey", dtoType);
    ctx.set("op", "delete");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "delete",
        dtoType,
        hasIdPath: typeof req.params.id === "string" && !!req.params.id.trim(),
        requestId: ctx.get("requestId"),
      },
      "selecting delete pipeline"
    );

    switch (dtoType) {
      case "user-auth": {
        const steps = UserAuthDeletePipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }
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
