// backend/services/t_entity_crud/src/controllers/xxx.read.controller/handlers/dbRead.get.handler.ts
/**
 * Docs:
 * - ADR-0040/41/42/43/44
 *
 * Purpose:
 * - Execute the read for GET /api/xxx/v1/read.
 * - Pulls DbReader<XxxDto> from ctx (default key: "dbReader").
 * - Builds a simple equality filter from path param (:xxxId) or req.query (?id=...).
 * - On success: { ok: true, doc }  (doc is DTO.toJson() if available)
 * - On not found: 404 problem+json.
 *
 * Notes:
 * - Coerces 24-hex id strings to Mongo ObjectId for reliability.
 */

import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { DbManagerHandler } from "@nv/shared/http/DbManagerHandler";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { ObjectId } from "mongodb";

function maybeObjectId(id: string): string | ObjectId {
  const hex24 = /^[0-9a-fA-F]{24}$/;
  return hex24.test(id) ? new ObjectId(id) : id;
}

function buildFilterFromCtx(ctx: HandlerContext): Record<string, unknown> {
  const params: any = ctx.get("params") ?? {};
  const q: any = ctx.get("query") ?? {};

  // Prefer path param if present: /read/:xxxId
  if (typeof params.xxxId === "string" && params.xxxId.trim() !== "") {
    const raw = params.xxxId.trim();
    return { _id: maybeObjectId(raw) };
  }

  // Fallback: ?id=... → filter by _id
  if (typeof q.id === "string" && q.id.trim() !== "") {
    const raw = q.id.trim();
    return { _id: maybeObjectId(raw) };
  }

  // Otherwise treat other query kv as equality filters, minus control params
  const filter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "page" || k === "limit" || k === "sort" || k === "id") continue;
    filter[k] = v;
  }
  return filter;
}

export class DbReadGetHandler extends DbManagerHandler<
  DbReader<XxxDto>,
  { doc?: XxxDto }
> {
  constructor(ctx: HandlerContext) {
    super(
      ctx,
      ctx.get<string>("read.dbReader.ctxKey") ?? "dbReader",
      async (r) => {
        const filter = buildFilterFromCtx(ctx);
        const doc = await r.readOne(filter);
        return { doc };
      },
      (c, { doc }) => {
        if (!doc) {
          c.set("handlerStatus", "error");
          c.set("status", 404);
          c.set("error", {
            code: "NOT_FOUND",
            message: "Document not found for supplied filter.",
            hint: "Use /read/<_id> or /read?id=<_id>. If your _id is Mongo ObjectId, ensure it’s 24-hex.",
          });
          return;
        }
        const json = (doc as any)?.toJson
          ? (doc as any).toJson()
          : (doc as any);
        c.set("result", { ok: true, doc: json });
      }
    );
  }
}
