// backend/services/test-log/src/controllers/test-log.update.controller/test-log.update.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; limit semantics)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *
 * Purpose:
 * - Orchestrate PATCH /api/test-log/v1/:dtoType/update/:id
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Canonical path param is "id" (legacy :testLogId normalized to ctx["id"]).
 * - DtoBag wrapper is enforced end-to-end; handlers read/write via ctx["bag"].
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as TestLogUpdatePipeline from "./pipelines/update.handlerPipeline";
// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoUpdatePipeline from "./pipelines/myNewDto.update.handlerPipeline";

export class TestLogUpdateController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async patch(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "update");

    // Normalize param to canonical "id" (stop testLogId drift)
    const idParam =
      (req.params as any)?.id ?? (req.params as any)?.testLogId ?? null;
    ctx.set("id", idParam);

    // Bind to meta.limit if present (singleton is enforced later in handlers)
    ctx.set("bagPolicy", { enforceLimitFromMeta: true });

    this.log.debug(
      {
        event: "pipeline_select",
        op: "update",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting update pipeline"
    );

    switch (dtoType) {
      case "test-log": {
        this.seedHydrator(ctx, "test-log", { validate: true });
        const steps = TestLogUpdatePipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   this.seedHydrator(ctx, "MyNewDto", { validate: true });
      //   const steps = MyNewDtoUpdatePipeline.getSteps(ctx, this);
      //   await this.runPipeline(ctx, steps, { requireRegistry: true });
      //   break;
      // }

      default: {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No update pipeline for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });
        this.log.warn(
          {
            event: "pipeline_missing",
            op: "update",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no update pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
