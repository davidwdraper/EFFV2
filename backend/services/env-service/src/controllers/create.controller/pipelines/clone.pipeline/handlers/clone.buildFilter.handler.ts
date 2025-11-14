// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/handlers/clone.buildFilter.handler.ts
/**
 * Docs:
 * - Inherit controller + pipeline docs.
 *
 * Purpose:
 * - Parse clone.sourceKey ("slug@version@env") and configure the shared
 *   BagPopulateQueryHandler via ctx["bag.query.*"].
 *
 * Inputs (ctx):
 * - "clone.sourceKey": string "slug@version@env"
 *
 * Outputs (ctx):
 * - "bag.query.dtoCtor"         = EnvServiceDto
 * - "bag.query.filter"          = { slug, version, env }
 * - "bag.query.targetKey"       = "clone.existingBag"
 * - "bag.query.ensureSingleton" = true
 * - "bag.query.validateReads"   = ctx["clone.validateReads"] ?? false
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class EnvServiceCloneBuildFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const sourceKey = String(this.ctx.get("clone.sourceKey") ?? "").trim();

    if (!sourceKey) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "CLONE_SOURCE_KEY_MISSING",
        title: "Bad Request",
        detail:
          "clone.sourceKey is required in the route as 'slug@version@env'.",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    const parts = sourceKey.split("@");
    if (parts.length !== 3) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "CLONE_SOURCE_KEY_INVALID",
        title: "Bad Request",
        detail:
          "clone.sourceKey must be in the form 'slug@version@env' (3 segments).",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    const [slug, versionStr, env] = parts.map((p) => p.trim());
    if (!slug || !env || !versionStr) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "CLONE_SOURCE_KEY_INVALID",
        title: "Bad Request",
        detail:
          "clone.sourceKey must contain a non-empty slug, version, and env.",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    const versionNum = Number(versionStr);
    if (!Number.isFinite(versionNum)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "CLONE_SOURCE_VERSION_INVALID",
        title: "Bad Request",
        detail:
          "clone.sourceKey version segment must be numeric (e.g. '1', '2').",
        requestId: this.ctx.get("requestId"),
      });
      return;
    }

    const validateReads = this.ctx.get<boolean>("clone.validateReads") ?? false;

    // Configure the shared BagPopulateQueryHandler.
    this.ctx.set("bag.query.dtoCtor", EnvServiceDto);
    this.ctx.set("bag.query.filter", {
      slug,
      version: versionNum,
      env,
    });
    this.ctx.set("bag.query.targetKey", "clone.existingBag");
    this.ctx.set("bag.query.ensureSingleton", true);
    this.ctx.set("bag.query.validateReads", validateReads);

    this.ctx.set("handlerStatus", "ok");
  }
}
