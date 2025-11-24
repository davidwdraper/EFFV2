// backend/services/env-service/src/controllers/list.controller/list.pipeline/handlers/query.handler.ts
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

export class QueryListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const q = (this.ctx.get("query") as Record<string, unknown>) ?? {};

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
        event: "query_parsed",
        filterKeys: Object.keys(filter),
        slug: filter.slug,
        env: filter.env,
        level: filter.level,
        version: filter.version,
      },
      "env-service list query parsed"
    );
  }
}
