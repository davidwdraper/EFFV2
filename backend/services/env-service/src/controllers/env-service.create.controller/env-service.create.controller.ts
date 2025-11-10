// backend/services/env-service/src/controllers/env-service.create.controller/env-service.create.controller.ts
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
 * - Orchestrate:
 *     - PUT /api/env-service/v1/:dtoType/create
 *     - PUT /api/env-service/v1/:dtoType/clone/:sourceKey/:targetSlug
 * - Thin controller: choose per-(dtoType, op) pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - Edges are bag-only for CREATE (payload { items:[{ type:"<dtoType>", ...}] } ).
 * - Create requires exactly 1 DTO item; enforced in pipeline handlers.
 * - Clone uses DB read → clone() → DB create; no direct caller mutation of DTOs.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per op)
import * as EnvServiceCreatePipeline from "./pipelines/env-service.create.handlerPipeline";
import * as EnvServiceClonePipeline from "./pipelines/env-service.clone.handlerPipeline";

// Future dtoType example (uncomment when adding a new type/op):
// import * as MyNewDtoCreatePipeline from "./pipelines/myNewDto.create.handlerPipeline";

export class EnvServiceCreateController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;
    const op = (req.params.op || "create").trim();

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", op);

    // Clone-specific route params (present only for op="clone")
    if (req.params.sourceKey) {
      ctx.set("clone.sourceKey", req.params.sourceKey);
    }
    if (req.params.targetSlug) {
      ctx.set("clone.targetSlug", req.params.targetSlug);
    }

    this.log.debug(
      {
        event: "pipeline_select",
        op,
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting create/clone pipeline"
    );

    switch (dtoType) {
      case "env-service": {
        switch (op) {
          case "create": {
            this.seedHydrator(ctx, "env-service", { validate: true });
            const steps = EnvServiceCreatePipeline.getSteps(ctx, this);
            await this.runPipeline(ctx, steps, { requireRegistry: true });
            break;
          }

          case "clone": {
            this.seedHydrator(ctx, "env-service", { validate: true });
            const steps = EnvServiceClonePipeline.getSteps(ctx, this);
            await this.runPipeline(ctx, steps, { requireRegistry: true });
            break;
          }

          default: {
            ctx.set("handlerStatus", "error");
            ctx.set("response.status", 501);
            ctx.set("response.body", {
              code: "NOT_IMPLEMENTED",
              title: "Not Implemented",
              detail: `No create pipeline for dtoType='${dtoType}', op='${op}'`,
              requestId: ctx.get("requestId"),
            });
            this.log.warn(
              {
                event: "pipeline_missing",
                op,
                dtoType,
                requestId: ctx.get("requestId"),
              },
              "no create/clone pipeline registered for dtoType/op"
            );
          }
        }
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
            event: "pipeline_missing_dtoType",
            op,
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no create/clone pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
