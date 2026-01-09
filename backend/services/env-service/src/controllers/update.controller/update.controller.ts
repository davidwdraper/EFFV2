// backend/services/env-service/src/controllers/update.controller/update.controller.ts
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
 *   - ADR-0098 (Domain-named pipelines with PL suffix)
 *   - ADR-0099 (Strict missing-test semantics)
 *   - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 *   - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Orchestrate PATCH /api/env-service/v1/:dtoType/update/:id
 * - Thin controller: select per-(dtoType, op) pipeline; execute seeder→handler pairs.
 *
 * Invariants:
 * - Canonical path param is "id" (legacy :envServiceId normalized to ctx["id"]).
 * - DtoBag wrapper is enforced end-to-end; handlers read/write via ctx["bag"].
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { resolveSeederCtor } from "@nv/shared/http/handlers/seeding/seederRegistry";

import { EnvServiceUpdatePL } from "./pipelines/update.pipeline/EnvServiceUpdatePL";

export class EnvServiceUpdateController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async patch(req: Request, res: Response): Promise<void> {
    const routeDtoType = (req.params.dtoType ?? "").trim();

    const ctx: HandlerContext = this.makeContext(req, res);

    const dtoKey = routeDtoType;
    const op = "update";

    ctx.set("dtoKey", dtoKey);
    ctx.set("op", op);

    // Normalize param to canonical "id" (stop envServiceId drift)
    const idParam =
      (req.params as any)?.id ?? (req.params as any)?.envServiceId ?? null;

    if (typeof idParam === "string" && idParam.trim()) {
      ctx.set("id", idParam.trim());
    } else {
      ctx.set("id", idParam);
    }

    // Bind to meta.limit if present (singleton enforced later in handlers)
    ctx.set("bagPolicy", { enforceLimitFromMeta: true });

    const requestId = ctx.get("requestId");

    // ───────────────────────────────────────────
    // Pipeline selection
    // ───────────────────────────────────────────
    let pl: EnvServiceUpdatePL | null = null;

    if (dtoKey === "env-service") pl = new EnvServiceUpdatePL();

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
      "env-service.update: selecting pipeline"
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
      "env-service.update: pipeline starting"
    );

    // ───────────────────────────────────────────
    // Execute seeder→handler pairs (ADR-0101)
    // ───────────────────────────────────────────
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
      "env-service.update: pipeline complete"
    );

    return super.finalize(ctx);
  }
}
