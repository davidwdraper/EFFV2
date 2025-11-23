// backend/services/svcconfig/src/controllers/svcconfig.list.controller/svcconfig.list.controller.ts
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
 * - Orchestrate "list-family" GET operations for svcconfig:
 *   - Standard list:  GET /api/svcconfig/v1/:dtoType/list
 *   - Mirror list:    GET /api/svcconfig/v1/:dtoType/mirror
 *
 * Notes:
 * - Cursor pagination via ?limit=&cursor= for list.
 * - Mirror reuses the same DbReadListHandler but uses a server-controlled filter.
 * - DTO is the source of truth; serialization via toJson() (stamps meta).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/AppBase";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one folder per dtoType for LIST)
import * as SvcconfigListPipeline from "./pipelines/list.handlerPipeline";
// Pipelines (one folder per dtoType for MIRROR — specialized list for gateway)
import * as SvcconfigMirrorPipeline from "./pipelines/mirror.handlerPipeline";

// Future dtoType example (uncomment when adding a new type):
// import * as MyNewDtoListPipeline from "./pipelines/myNewDto.list.handlerPipeline";

export class SvcconfigListController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  /**
   * Multi-op list:
   * - GET /api/svcconfig/v1/:dtoType/:op
   *   - op = "list"   → standard list with query-based filters
   *   - op = "mirror" → mirror list for gateway (server-side filter only)
   */
  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;
    const op = (req.params.op as string) || "list";

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", op);

    this.log.debug(
      {
        event: "pipeline_select",
        op,
        dtoType,
        requestId: ctx.get("requestId"),
      },
      "selecting svcconfig list-family pipeline"
    );

    switch (dtoType) {
      case "svcconfig": {
        // All list-family ops hydrate as svcconfig DTOs
        this.seedHydrator(ctx, "svcconfig", { validate: false });

        switch (op) {
          case "list": {
            const steps = SvcconfigListPipeline.getSteps(ctx, this);
            await this.runPipeline(ctx, steps, { requireRegistry: false });
            break;
          }

          case "mirror": {
            const steps = SvcconfigMirrorPipeline.getSteps(ctx, this);
            await this.runPipeline(ctx, steps, { requireRegistry: false });
            break;
          }

          default: {
            ctx.set("handlerStatus", "error");
            ctx.set("response.status", 501);
            ctx.set("response.body", {
              code: "NOT_IMPLEMENTED",
              title: "Not Implemented",
              detail: `No list-family pipeline for op='${op}' on dtoType='${dtoType}'`,
              requestId: ctx.get("requestId"),
            });

            this.log.warn(
              {
                event: "pipeline_missing",
                op,
                dtoType,
                requestId: ctx.get("requestId"),
              },
              "no list-family pipeline registered for op"
            );
          }
        }

        break;
      }

      // Future dtoType example:
      // case "myNewDto": {
      //   this.seedHydrator(ctx, "MyNewDto", { validate: true });
      //   switch (op) {
      //     case "list": {
      //       const steps = MyNewDtoListPipeline.getSteps(ctx, this);
      //       await this.runPipeline(ctx, steps, { requireRegistry: false });
      //       break;
      //     }
      //     default: {
      //       ctx.set("handlerStatus", "error");
      //       ctx.set("response.status", 501);
      //       ctx.set("response.body", {
      //         code: "NOT_IMPLEMENTED",
      //         title: "Not Implemented",
      //         detail: `No list-family pipeline for op='${op}' on dtoType='${dtoType}'`,
      //         requestId: ctx.get("requestId"),
      //       });
      //       this.log.warn(
      //         {
      //           event: "pipeline_missing",
      //           op,
      //           dtoType,
      //           requestId: ctx.get("requestId"),
      //         },
      //         "no list-family pipeline registered for op"
      //       );
      //     }
      //   }
      //   break;
      // }

      default: {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 501);
        ctx.set("response.body", {
          code: "NOT_IMPLEMENTED",
          title: "Not Implemented",
          detail: `No list-family controller for dtoType='${dtoType}'`,
          requestId: ctx.get("requestId"),
        });

        this.log.warn(
          {
            event: "pipeline_missing",
            op,
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no list-family pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
