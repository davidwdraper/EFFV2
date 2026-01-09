// backend/services/env-service/src/controllers/delete.controller/delete.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0056 (DELETE path uses <DtoTypeKey>) — generalized: :dtoType on every route
 *   - ADR-0098 (Domain-named pipelines with PL suffix)
 *   - ADR-0099 (Strict missing-test semantics)
 *   - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 *   - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Orchestrate DELETE /api/env-service/v1/:dtoType/delete/:id
 * - Thin controller: select per-(dtoType, op) pipeline; execute seeder→handler pairs.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { resolveSeederCtor } from "@nv/shared/http/handlers/seeding/seederRegistry";

import { EnvServiceDeletePL } from "./pipelines/delete.pipeline/EnvServiceDeletePL";

export class EnvServiceDeleteController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async delete(req: Request, res: Response): Promise<void> {
    const routeDtoType = (req.params.dtoType ?? "").trim();

    const ctx: HandlerContext = this.makeContext(req, res);

    const dtoKey = routeDtoType;
    const op = "delete";

    ctx.set("dtoKey", dtoKey);
    ctx.set("op", op);

    // Preserve route param for handlers that expect it.
    if (typeof req.params.id === "string" && req.params.id.trim()) {
      ctx.set("id", req.params.id.trim());
    }

    const requestId = ctx.get("requestId");

    // ───────────────────────────────────────────
    // Pipeline selection
    // ───────────────────────────────────────────
    let pl: EnvServiceDeletePL | null = null;

    if (dtoKey === "env-service") pl = new EnvServiceDeletePL();

    if (!pl) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 501);
      ctx.set("response.body", {
        code: "NOT_IMPLEMENTED",
        title: "Not Implemented",
        detail: `No pipeline for dtoType='${routeDtoType}', op='${op}' on env-service.`,
        requestId,
      });
      return super.finalize(ctx);
    }

    const pipelineName = pl.pipelineName();

    this.log.pipeline(
      {
        event: "pipeline_select",
        op,
        dtoType: dtoKey,
        requestId,
        pipeline: pipelineName,
      },
      "env-service.delete: selecting pipeline"
    );

    const stepDefs = pl.getStepDefs("live");

    this.log.pipeline(
      {
        event: "pipeline_start",
        op,
        dtoType: dtoKey,
        requestId,
        pipeline: pipelineName,
        steps: (stepDefs as any[]).map((d: any) => ({
          seed:
            typeof d?.seedName === "string" && d.seedName.trim()
              ? d.seedName.trim()
              : "noop",
          handler: String(d?.handlerName ?? ""),
        })),
      },
      "env-service.delete: pipeline starting"
    );

    for (const d of stepDefs as any[]) {
      const seedName =
        typeof d?.seedName === "string" && d.seedName.trim()
          ? d.seedName.trim()
          : "noop";

      const seedSpec =
        d && typeof d?.seedSpec === "object" && d.seedSpec !== null
          ? d.seedSpec
          : {};

      // 1) seed
      const SeederCtor = (d?.seederCtor ?? resolveSeederCtor(seedName)) as any;
      const seeder = new SeederCtor(ctx, this, seedSpec);
      await seeder.run();

      if (ctx.get("handlerStatus") === "error") break;

      // 2) handler
      const h = new d.handlerCtor(ctx, this, d.handlerInit);
      await h.run();

      if (ctx.get("handlerStatus") === "error") break;
    }

    const handlerStatus = ctx.get("handlerStatus") ?? "success";

    this.log.pipeline(
      {
        event: "pipeline_complete",
        op,
        dtoType: dtoKey,
        requestId,
        pipeline: pipelineName,
        handlerStatus,
      },
      "env-service.delete: pipeline complete"
    );

    return super.finalize(ctx);
  }
}
