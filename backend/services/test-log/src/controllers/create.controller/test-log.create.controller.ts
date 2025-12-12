// backend/services/test-log/src/controllers/test-log.create.controller/test-log.create.controller.ts
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
 * - Orchestrate PUT /api/test-log/v1/:dtoType/create
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Edges are bag-only (payload { items:[{ type:"<dtoType>", ...}] } ).
 * - Create requires exactly 1 DTO item; enforced in pipeline handlers.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Shared create pipeline (works for both DTO types)
import * as TestLogCreatePipeline from "./pipelines/create.handlerPipeline";

export class TestLogCreateController extends ControllerJsonBase {
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
      case "test-run":
      case "test-handler": {
        // Seed hydrator for the exact registry / DTO type key.
        this.seedHydrator(ctx, dtoType, { validate: true });

        const steps = TestLogCreatePipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }

      default: {
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
