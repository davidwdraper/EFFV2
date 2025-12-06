// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/handlers/code.clone.ts
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
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class CodeCloneHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  /**
   * Handler identity for logs and diagnostics.
   */
  public handlerName(): string {
    return "code.clone";
  }

  /**
   * Short, operator-facing purpose string.
   */
  protected handlerPurpose(): string {
    return "Parse clone.sourceKey (slug@version@env) and configure bag.query.* for BagPopulateQueryHandler.";
  }

  /**
   * Execute:
   * - Validate clone.sourceKey format.
   * - Derive slug/version/env.
   * - Configure bag.query.* for downstream population.
   */
  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    try {
      const sourceKeyRaw = this.ctx.get("clone.sourceKey");
      const sourceKey =
        typeof sourceKeyRaw === "string" ? sourceKeyRaw.trim() : "";

      if (!sourceKey) {
        this.failWithError({
          httpStatus: 400,
          title: "clone_source_key_missing",
          detail:
            "clone.sourceKey is required in the route as 'slug@version@env'.",
          stage: "clone.sourceKey.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.clone: clone.sourceKey is missing or empty.",
          logLevel: "warn",
        });
        return;
      }

      const parts = sourceKey.split("@");
      if (parts.length !== 3) {
        this.failWithError({
          httpStatus: 400,
          title: "clone_source_key_invalid",
          detail:
            "clone.sourceKey must be in the form 'slug@version@env' (3 segments).",
          stage: "clone.sourceKey.segment_count",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.clone: clone.sourceKey did not contain exactly 3 segments.",
          logLevel: "warn",
        });
        return;
      }

      const [slugRaw, versionStrRaw, envRaw] = parts;
      const slug = slugRaw.trim();
      const versionStr = versionStrRaw.trim();
      const env = envRaw.trim();

      if (!slug || !versionStr || !env) {
        this.failWithError({
          httpStatus: 400,
          title: "clone_source_key_invalid",
          detail:
            "clone.sourceKey must contain a non-empty slug, version, and env.",
          stage: "clone.sourceKey.empty_segments",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.clone: one or more clone.sourceKey segments were empty after trim().",
          logLevel: "warn",
        });
        return;
      }

      const versionNum = Number(versionStr);
      if (!Number.isFinite(versionNum)) {
        this.failWithError({
          httpStatus: 400,
          title: "clone_source_version_invalid",
          detail:
            "clone.sourceKey version segment must be numeric (e.g. '1', '2').",
          stage: "clone.sourceKey.version_nan",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.clone.code.clone: version segment of clone.sourceKey was not a finite number.",
          logLevel: "warn",
        });
        return;
      }

      const validateReads =
        this.ctx.get<boolean>("clone.validateReads") ?? false;

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

      this.log.debug(
        {
          event: "clone_query_configured",
          slug,
          version: versionNum,
          env,
          validateReads,
          requestId,
        },
        "env-service.clone.code.clone: configured bag.query.* for BagPopulateQueryHandler"
      );
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "clone_source_key_handler_failure",
        detail:
          "Unhandled exception while parsing clone.sourceKey. Ops: inspect logs for requestId and stack frame.",
        stage: "clone.sourceKey.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.clone.code.clone: unhandled exception in handler execute().",
        logLevel: "error",
      });
    }
  }
}
