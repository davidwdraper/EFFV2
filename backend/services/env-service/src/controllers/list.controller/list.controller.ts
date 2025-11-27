// backend/services/env-service/src/controllers/list.controller/list.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *
 * Purpose:
 * - Orchestrate GET /api/env-service/v1/:dtoType/list
 * - Thin controller: choose per-dtoType pipeline; pipeline defines handler order.
 *
 * Notes:
 * - Cursor pagination via ?limit=&cursor=.
 * - DTO is the source of truth; serialization via toJson() (stamps meta).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType)
import * as EnvServiceListPipeline from "./pipelines/list.pipeline";
// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoListPipeline from "./pipelines/myNewDto.list.handlerPipeline";

export class EnvServiceListController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "list");

    this.log.debug(
      {
        event: "pipeline_select",
        op: "list",
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting list pipeline"
    );

    switch (dtoType) {
      case "env-service": {
        this.seedHydrator(ctx, "env-service", { validate: false }); // <== don't need to validate
        const steps = EnvServiceListPipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: false });
        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   this.seedHydrator(ctx, "MyNewDto", { validate: true });
      //   const steps = MyNewDtoListPipeline.getSteps(ctx, this);
      //   await this.runPipeline(ctx, steps, { requireRegistry: false });
      //   break;
      // }

      default: {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No list pipeline for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });
        this.log.warn(
          {
            event: "pipeline_missing",
            op: "list",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no list pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
