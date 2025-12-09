// backend/services/test-runner/src/controllers/run.controller/test-runner.run.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Orchestrate POST /api/test-runner/v1/:dtoType/run-test
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Edges are bag-only for service APIs; test-runner itself may evolve to hydrate
 *   a TestRootDto bag from discovery results.
 * - Controller does orchestration only; no test execution or file-system logic here.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as TestRunnerRunPipeline from "./pipelines/run.handlerPipeline";
// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoRunPipeline from "./pipelines/myNewDto.run.handlerPipeline";

export class TestRunnerRunController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async post(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "run");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "run",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "test-runner.run: selecting run pipeline"
    );

    switch (dtoType) {
      case "test-runner": {
        // For now, the run pipeline starts with CodeTreeWalkerHandler,
        // which discovers pipelines. Future handlers will hydrate a
        // TestRootDto and bag for wire output.
        const steps = TestRunnerRunPipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, {
          // Tree-walker does not require the DTO registry; later stages may.
          requireRegistry: false,
        });
        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   const steps = MyNewDtoRunPipeline.getSteps(ctx, this);
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
          detail: `No run pipeline for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });

        this.log.warn(
          {
            event: "pipeline_missing",
            op: "run",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "test-runner.run: no run pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
