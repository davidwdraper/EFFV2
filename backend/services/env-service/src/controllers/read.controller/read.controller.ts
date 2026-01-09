// backend/services/env-service/src/controllers/read.controller/read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *   - ADR-0098 (Domain-named pipelines with PL suffix)
 *   - ADR-0099 (Strict missing-test semantics)
 *   - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 *   - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Orchestrate GET /api/env-service/v1/:dtoType/config
 * - Thin controller: config-only; no op switching.
 *
 * Invariants:
 * - Config read always uses op="config" (query: env, slug, version, level).
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { resolveSeederCtor } from "@nv/shared/http/handlers/seeding/seederRegistry";

import { EnvServiceReadPL } from "./pipelines/config.pipeline/EnvServiceReadPL";

export class EnvServiceReadController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const routeDtoType = (req.params.dtoType ?? "").trim();
    const op = "config";

    const ctx: HandlerContext = this.makeContext(req, res);
    const dtoKey = routeDtoType;

    ctx.set("dtoKey", dtoKey);
    ctx.set("op", op);

    const requestId = ctx.get("requestId");

    // ───────────────────────────────────────────
    // Pipeline selection
    // ───────────────────────────────────────────
    let pl: EnvServiceReadPL | null = null;

    if (dtoKey === "env-service") pl = new EnvServiceReadPL();

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
      "env-service.read: selecting pipeline"
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
      "env-service.read: pipeline starting"
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

      // 1) seed (most rungs here use seedName=noop; the “seed.*” steps are handlers today)
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
      "env-service.read: pipeline complete"
    );

    return super.finalize(ctx);
  }
}
