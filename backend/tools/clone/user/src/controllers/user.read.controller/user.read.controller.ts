// backend/services/user/src/controllers/user.read.controller/user.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Orchestrate GET /api/user/v1/:dtoType/read/:id
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Primary-key only. Canonical id is "id". No fallbacks, no filters.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as UserReadPipeline from "./pipelines/user.read.handlerPipeline";
// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoReadPipeline from "./pipelines/myNewDto.read.handlerPipeline";

export class UserReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "read");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "read",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting read pipeline"
    );

    switch (dtoType) {
      case "user": {
        const steps = UserReadPipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: false }); // read-by-id doesn’t need registry
        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   const steps = MyNewDtoReadPipeline.getSteps(ctx, this);
      //   await this.runPipeline(ctx, steps, { requireRegistry: false });
      //   break;
      // }

      default: {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No read pipeline for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });
        this.log.warn(
          {
            event: "pipeline_missing",
            op: "read",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no read pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
