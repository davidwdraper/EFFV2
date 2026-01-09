// backend/services/env-service/src/controllers/create.controller/create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *   - ADR-0098 (Domain-named pipelines with PL suffix)
 *   - ADR-0099 (Strict missing-test semantics)
 *   - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 *   - ADR-0101 (Universal seeder + seeder→handler pairs)
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *
 * Purpose:
 * - Orchestrate:
 *     - PUT /api/env-service/v1/:dtoType/create
 *     - PUT /api/env-service/v1/:dtoType/clone/:sourceKey/:targetSlug
 * - Thin controller: select per-(dtoType, op) pipeline; execute seeder→handler pairs.
 *
 * Invariants:
 * - Controller orchestrates only; handlers do work.
 * - No ID minting here. No business logic here.
 */

import { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

import { resolveSeederCtor } from "@nv/shared/http/handlers/seeding/seederRegistry";

// Pipelines (one folder per op)
import { EnvServiceCreatePL } from "./pipelines/create.pipeline/EnvServiceCreatePL";
import { EnvServiceCreateClonePL } from "./pipelines/clone.pipeline/EnvServiceCreateClonePL";

export class EnvServiceCreateController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async put(req: Request, res: Response): Promise<void> {
    const routeDtoType = (req.params.dtoType ?? "").trim();

    // op selection:
    // - if the route exposes :op, we respect it
    // - otherwise, infer clone when clone params exist
    const rawOp =
      typeof (req.params as any)?.op === "string" ? (req.params as any).op : "";
    const inferredOp =
      typeof req.params.sourceKey === "string" ||
      typeof req.params.targetSlug === "string"
        ? "clone"
        : "create";

    const op = (rawOp || inferredOp || "create").trim();

    const ctx: HandlerContext = this.makeContext(req, res);

    // Route param remains for URL stability; dtoKey is what the rails use.
    const dtoKey = routeDtoType;

    ctx.set("dtoKey", dtoKey);
    ctx.set("op", op);

    // Clone-specific route params
    if (
      typeof req.params.sourceKey === "string" &&
      req.params.sourceKey.trim()
    ) {
      ctx.set("clone.sourceKey", req.params.sourceKey.trim());
    }
    if (
      typeof req.params.targetSlug === "string" &&
      req.params.targetSlug.trim()
    ) {
      ctx.set("clone.targetSlug", req.params.targetSlug.trim());
    }

    const requestId = ctx.get("requestId");

    // ───────────────────────────────────────────
    // Pipeline selection (dtoType + op)
    // ───────────────────────────────────────────
    let pl: EnvServiceCreatePL | EnvServiceCreateClonePL | null = null;

    if (dtoKey === "env-service") {
      if (op === "create") pl = new EnvServiceCreatePL();
      else if (op === "clone") pl = new EnvServiceCreateClonePL();
    }

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
      "env-service.create: selecting pipeline"
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
      "env-service.create: pipeline starting"
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
      "env-service.create: pipeline complete"
    );

    return super.finalize(ctx);
  }
}
