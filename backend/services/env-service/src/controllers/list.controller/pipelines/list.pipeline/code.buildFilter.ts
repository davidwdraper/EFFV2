// backend/services/env-service/src/controllers/list.controller/list.pipeline/handlers/code.buildfilter.ts
/**
 * Docs:
 * - ADR-0041/0042
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
 * - version: number (exact match)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

export class CodeBuildFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  /**
   * Short, operator-facing purpose string.
   */
  protected handlerPurpose(): string {
    return "Parse env-service list query params into a safe list.filter object for known EnvServiceDto fields (slug, env, level, version).";
  }

  /**
   * Execute:
   * - Safely read ctx["query"] (tolerate missing/invalid values).
   * - Whitelist known fields (slug, env, level, version).
   * - Attach the resulting filter to ctx["list.filter"].
   */
  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    try {
      const rawQuery = this.safeCtxGet<unknown>("query");
      const q =
        rawQuery && typeof rawQuery === "object"
          ? (rawQuery as Record<string, unknown>)
          : {};

      const filter: Record<string, unknown> = {};

      if (typeof q.slug === "string" && q.slug.trim()) {
        filter.slug = q.slug.trim();
      }

      if (typeof q.env === "string" && q.env.trim()) {
        filter.env = q.env.trim();
      }

      if (typeof q.level === "string" && q.level.trim()) {
        filter.level = q.level.trim();
      }

      if (q.version !== undefined) {
        const n =
          typeof q.version === "string"
            ? Number(q.version)
            : (q.version as number);
        if (Number.isFinite(n)) {
          filter.version = Math.trunc(n);
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
    } catch (err) {
      // Unexpected handler bug
      this.failWithError({
        httpStatus: 500,
        title: "env_service_list_filter_failure",
        detail:
          "Unhandled exception while building list.filter from query params. Ops: inspect logs for requestId and stack frame.",
        stage: "list.build_filter.execute",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.list.buildFilter: unhandled exception in handler.",
        logLevel: "error",
      });
    }
  }
}
