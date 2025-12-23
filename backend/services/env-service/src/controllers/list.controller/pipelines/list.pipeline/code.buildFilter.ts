// backend/services/env-service/src/controllers/list.controller/list.pipeline/handlers/code.buildfilter.ts
/**
 * Docs:
 * - ADR-0041/0042
 * - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Parse query params into a safe filter object for known EnvServiceDto fields only.
 *
 * Inputs (ctx):
 * - "query": Record<string, unknown> (seeded by ControllerBase)
 *
 * Outputs (ctx):
 * - "list.filter": Record<string, unknown>
 *
 * Supported query params:
 * - slug:    string (exact match)
 * - env:     string (exact match)
 * - level:   string (exact match, e.g. "root" | "service")
 * - version: number (exact match; positive int)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

export class CodeBuildFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "code.buildFilter";
  }

  protected handlerPurpose(): string {
    return "Parse env-service list query params into a safe list.filter object for known EnvServiceDto fields (slug, env, level, version).";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const rawQuery = this.safeCtxGet<unknown>("query");
    const q =
      rawQuery && typeof rawQuery === "object"
        ? (rawQuery as Record<string, unknown>)
        : {};

    const filter: Record<string, unknown> = {};

    const slug = typeof q.slug === "string" ? q.slug.trim() : "";
    if (slug) filter.slug = slug;

    const env = typeof q.env === "string" ? q.env.trim() : "";
    if (env) filter.env = env;

    const level = typeof q.level === "string" ? q.level.trim() : "";
    if (level) filter.level = level;

    if (q.version !== undefined) {
      const n =
        typeof q.version === "string"
          ? Number(q.version)
          : (q.version as number);

      // Keep it strict: version must be a positive integer if provided.
      if (Number.isInteger(n) && n > 0) {
        filter.version = n;
      }
    }

    this.ctx.set("list.filter", filter);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "env_service_list_query_parsed",
        filterKeys: Object.keys(filter),
        slug: filter.slug,
        env: filter.env,
        level: filter.level,
        version: filter.version,
        requestId,
      },
      "env-service list query parsed into list.filter"
    );
  }
}
