// backend/services/svcconfig/src/controllers/svcconfig.read.controller/svcconfig.read.controller.ts
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
 *   - ADR-0061 (svcconfig s2s-route — S2S target resolution)
 *
 * Purpose:
 * - Orchestrate:
 *   - GET /api/svcconfig/v1/:dtoType/read/:id
 *   - GET /api/svcconfig/v1/:dtoType/s2s-route?env=&slug=&majorVersion=
 * - Thin controller: choose per-dtoType + per-op pipeline; pipeline defines handler order.
 *
 * Invariants:
 * - op="read"       ⇒ primary-key read by id (no filters).
 * - op="s2s-route"  ⇒ single-record read by composite key (env + slug + majorVersion),
 *   with typed values seeded into HandlerContext.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipelines (one module per dtoType/op)
import * as SvcconfigReadPipeline from "./pipelines/read.handlerPipeline";
import * as SvcconfigS2sRoutePipeline from "./pipelines/s2s-route.pipeline";

// DTO ctor used for query-based reads
import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";

export class SvcconfigReadController extends ControllerBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType as string;

    // Route wiring:
    //   GET /:dtoType/read/:id        → op="read"
    //   GET /:dtoType/s2s-route?...   → op="s2s-route"
    const isS2sRoute = req.path.includes("/s2s-route");
    const op = isS2sRoute ? "s2s-route" : "read";

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
      "svcconfig.read.controller — selecting pipeline"
    );

    switch (dtoType) {
      case "svcconfig": {
        let steps;

        if (op === "read") {
          // Existing by-id read pipeline: GET /:dtoType/read/:id
          steps = SvcconfigReadPipeline.getSteps(ctx, this);
        } else if (op === "s2s-route") {
          // S2S route lookup:
          //   GET /:dtoType/s2s-route?env=&slug=&majorVersion=
          //
          // Controller is responsible for:
          //   - parsing / normalizing query strings
          //   - seeding typed values into ctx
          // Shared query handler then reads those from ctx (source: "ctx").

          const envRaw = req.query.env;
          const slugRaw = req.query.slug;
          const majorVersionRaw = req.query.majorVersion;

          const env = typeof envRaw === "string" ? envRaw.trim() : "";
          const slug = typeof slugRaw === "string" ? slugRaw.trim() : "";

          let majorVersion: number | undefined;
          if (typeof majorVersionRaw === "string") {
            const parsed = Number(majorVersionRaw.trim());
            if (!Number.isNaN(parsed)) {
              majorVersion = parsed;
            }
          }

          ctx.set("env", env);
          ctx.set("slug", slug);
          ctx.set("majorVersion", majorVersion);

          // Config for bag.populate.query.handler
          ctx.set("bag.query.dtoCtor", SvcconfigDto);
          ctx.set("bag.query.targetKey", "bag");
          ctx.set("bag.query.validateReads", false);
          ctx.set("bag.query.ensureSingleton", true);

          steps = SvcconfigS2sRoutePipeline.getSteps(ctx, this);
        } else {
          ctx.set("handlerStatus", "error");
          ctx.set("response.status", 501);
          ctx.set("response.body", {
            code: "NOT_IMPLEMENTED",
            title: "Not Implemented",
            detail: `No read op='${op}' for dtoType='${dtoType}'`,
            requestId: ctx.get("requestId"),
          });
          this.log.warn(
            {
              event: "read_op_missing",
              op,
              dtoType,
              requestId: ctx.get("requestId"),
            },
            "svcconfig.read.controller — no read op registered for dtoType"
          );
          return super.finalize(ctx);
        }

        await this.runPipeline(ctx, steps, { requireRegistry: false });
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
            op,
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "svcconfig.read.controller — no read pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }
}
