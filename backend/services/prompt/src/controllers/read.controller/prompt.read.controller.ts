// backend/services/prompt/src/controllers/prompt.read.controller/prompt.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *   - ADR-0075 (Controller seeds dtoCtor for db.* read handlers)
 *
 * Purpose:
 * - Orchestrate prompt reads by business key:
 *   GET /api/prompt/v1/:dtoType/read/:language/:version/:promptKey
 * - (Compat) Support alias route:
 *   GET /api/prompt/v1/:dtoType/readByKey?language=&version=&promptKey=
 *
 * Invariants:
 * - DTO hydration from DB requires a Registry-resolved dtoCtor (ADR-0075).
 * - No silent fallbacks for infra errors; infra failures are surfaced by PromptsClient/ControllerJsonBase.
 * - Missing prompt key is acceptable: pipeline returns empty items[] → caller falls back to promptKey.
 */

import type { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

// Pipeline
import * as PromptReadPipeline from "./pipelines/read.handlerPipeline";

export class PromptReadController extends ControllerJsonBase {
  constructor(app: AppBase) {
    super(app);
  }

  public async get(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "read");

    // Primary route: /read/:language/:version/:promptKey
    const languageParam = req.params.language;
    const versionParam = req.params.version;
    const promptKeyParam = req.params.promptKey;

    if (typeof languageParam === "string" && languageParam.trim()) {
      ctx.set("language", languageParam.trim());
    }
    if (typeof versionParam === "string" && versionParam.trim()) {
      const v = Number(versionParam);
      if (Number.isFinite(v)) ctx.set("version", Math.trunc(v));
    }
    if (typeof promptKeyParam === "string" && promptKeyParam.trim()) {
      ctx.set("promptKey", promptKeyParam.trim());
    }

    this.log.debug(
      {
        event: "pipeline_select",
        op: "read",
        dtoType,
        requestId: ctx.get("requestId"),
        language: ctx.get("language"),
        version: ctx.get("version"),
        promptKey: ctx.get("promptKey"),
      },
      "selecting read pipeline"
    );

    switch (dtoType) {
      case "prompt": {
        // ADR-0075: DB-hydrating handlers require the Registry-resolved ctor on ctx.
        // We seed it in the controller (orchestration), keeping db.* handlers generic.
        const registry = this.app.getDtoRegistry();
        const dtoCtor = registry.resolveCtorByType(dtoType);
        ctx.set("bag.query.dtoCtor", dtoCtor);

        const steps = PromptReadPipeline.getSteps(ctx, this);

        // DB-hydrating pipelines require registry preflight.
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }

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
            op: "read",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no read pipeline registered for dtoType"
        );
      }
    }

    return super.finalize(ctx);
  }

  /**
   * Compat alias for legacy callers:
   * GET /:dtoType/readByKey?language=&version=&promptKey=
   */
  public async getByKey(req: Request, res: Response): Promise<void> {
    const dtoType = req.params.dtoType;

    const ctx: HandlerContext = this.makeContext(req, res);
    ctx.set("dtoType", dtoType);
    ctx.set("op", "read");

    const language =
      typeof req.query.language === "string" ? req.query.language : "";
    const versionRaw =
      typeof req.query.version === "string" ? req.query.version : "";
    const promptKey =
      typeof req.query.promptKey === "string" ? req.query.promptKey : "";

    if (language.trim()) ctx.set("language", language.trim());

    const v = Number(versionRaw);
    if (Number.isFinite(v)) ctx.set("version", Math.trunc(v));

    if (promptKey.trim()) ctx.set("promptKey", promptKey.trim());

    this.log.debug(
      {
        event: "pipeline_select",
        op: "readByKey",
        dtoType,
        requestId: ctx.get("requestId"),
        language: ctx.get("language"),
        version: ctx.get("version"),
        promptKey: ctx.get("promptKey"),
      },
      "selecting readByKey pipeline (compat)"
    );

    switch (dtoType) {
      case "prompt": {
        // ADR-0075: DB-hydrating handlers require the Registry-resolved ctor on ctx.
        const registry = this.app.getDtoRegistry();
        const dtoCtor = registry.resolveCtorByType(dtoType);
        ctx.set("bag.query.dtoCtor", dtoCtor);

        const steps = PromptReadPipeline.getSteps(ctx, this);
        await this.runPipeline(ctx, steps, { requireRegistry: true });
        break;
      }

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
            op: "readByKey",
            dtoType,
            requestId: ctx.get("requestId"),
          },
          "no read pipeline registered for dtoType (compat)"
        );
      }
    }

    return super.finalize(ctx);
  }
}
