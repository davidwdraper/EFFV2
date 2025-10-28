// backend/services/t_entity_crud/src/controllers/xxx.list.controller/handlers/query.list.handler.ts
/**
 * Docs:
 * - ADR-0041/0042
 *
 * Purpose:
 * - Parse query params into a safe filter object for known fields only.
 *
 * Inputs (ctx):
 * - "query": Record<string, unknown> (seeded by ControllerBase)
 *
 * Outputs (ctx):
 * - "list.filter": Record<string, unknown>
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";

export class QueryListHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const q = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    // Allow filtering on known fields only; ignore unknowns.
    const filter: Record<string, unknown> = {};

    if (typeof q.txtfield1 === "string" && q.txtfield1.trim()) {
      filter.txtfield1 = q.txtfield1.trim();
    }
    if (typeof q.txtfield2 === "string" && q.txtfield2.trim()) {
      filter.txtfield2 = q.txtfield2.trim();
    }
    if (q.numfield1 !== undefined) {
      const n =
        typeof q.numfield1 === "string"
          ? Number(q.numfield1)
          : (q.numfield1 as number);
      if (Number.isFinite(n)) filter.numfield1 = n;
    }
    if (q.numfield2 !== undefined) {
      const n =
        typeof q.numfield2 === "string"
          ? Number(q.numfield2)
          : (q.numfield2 as number);
      if (Number.isFinite(n)) filter.numfield2 = n;
    }

    this.ctx.set("list.filter", filter);
    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      { event: "query_parsed", filterKeys: Object.keys(filter) },
      "list query parsed"
    );
  }
}
