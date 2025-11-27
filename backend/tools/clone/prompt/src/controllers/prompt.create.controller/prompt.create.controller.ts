// backend/services/prompt/src/controllers/prompt.create.controller/prompt.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Orchestrate PUT /api/prompt/v1/:dtoType/create
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Edges are bag-only (payload { items:[{ type:"<dtoType>", ...}] } ).
 * - Create requires exactly 1 DTO item; enforced in pipeline handlers.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as PromptCreatePipeline from "./pipelines/prompt.create.handlerPipeline";
// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoCreatePipeline from "./pipelines/myNewDto.create.handlerPipeline";

export class PromptCreateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "create");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "create",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting create pipeline"
    );

    switch (dtoType) {
      case "prompt": {
        this.seedHydrator(ctx, "prompt", { validate: true });
        const steps = PromptCreatePipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   this.seedHydrator(ctx, "MyNewDto", { validate: true });
      //   const steps = MyNewDtoCreatePipeline.getSteps(ctx, this);
      //   await this.runPipeline(ctx, steps, { requireRegistry: true });
      //   break;
      // }

      default: {
        // Seed a clear 501 problem into the context (ControllerBase.finalize will serialize)
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No create pipeline for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });

        this.log.warn(
          {
            event: "pipeline_missing",
            op: "create",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no create pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
