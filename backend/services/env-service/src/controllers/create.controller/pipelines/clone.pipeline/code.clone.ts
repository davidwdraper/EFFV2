// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/handlers/code.clone.ts
/**
 * Docs:
 * - Inherit controller + pipeline docs.
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Parse clone.sourceKey ("slug@version@env") and configure the shared
 *   BagPopulateQueryHandler via ctx["bag.query.*"].
 *
 * Inputs (ctx):
 * - "clone.sourceKey": string "slug@version@env"
 *
 * Outputs (ctx):
 * - "bag.query.dtoCtor"         = DbEnvServiceDto
 * - "bag.query.filter"          = { slug, version, env }
 * - "bag.query.targetKey"       = "clone.existingBag"
 * - "bag.query.ensureSingleton" = true
 * - "bag.query.validateReads"   = ctx["clone.validateReads"] ?? false
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";

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

    const sourceKeyRaw = this.safeCtxGet<unknown>("clone.sourceKey");
    const sourceKey =
      typeof sourceKeyRaw === "string" ? sourceKeyRaw.trim() : "";

    if (!sourceKey) {
      this.failWithError({
        httpStatus: 400,
        title: "clone_source_key_missing",
        detail:
          "clone.sourceKey is required in the route as 'slug@version@env'.",
        stage: "code.clone:missing_source_key",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.clone.code.clone: clone.sourceKey missing/empty.",
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
        stage: "code.clone:segment_count",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.clone.code.clone: clone.sourceKey must have exactly 3 segments.",
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
        stage: "code.clone:empty_segments",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.clone.code.clone: clone.sourceKey had empty segments after trim().",
        logLevel: "warn",
      });
      return;
    }

    const versionNum = Number(versionStr);
    // Version MUST be a positive integer. No floats, no NaN, no "1e3".
    if (!Number.isInteger(versionNum) || versionNum <= 0) {
      this.failWithError({
        httpStatus: 400,
        title: "clone_source_version_invalid",
        detail:
          "clone.sourceKey version segment must be a positive integer (e.g. '1', '2').",
        stage: "code.clone:version_invalid",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.clone.code.clone: version segment invalid (expected positive integer).",
        logLevel: "warn",
      });
      return;
    }

    const validateReads =
      this.safeCtxGet<boolean>("clone.validateReads") === true;

    // Configure the shared BagPopulateQueryHandler.
    this.ctx.set("bag.query.dtoCtor", DbEnvServiceDto);
    this.ctx.set("bag.query.filter", { slug, version: versionNum, env });
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
  }
}
