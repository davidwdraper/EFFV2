// backend/services/env-service/src/controllers/env-service.read.controller/handlers/dbRead.get.handler.ts
/**
 * Docs:
 * - ADR-0040/41/42/43/44/48
 *
 * Purpose:
 * - Single-record read:
 *   1) If an id is present (path/query), read by canonical DTO id (string).
 *   2) Else, read-one by a tight filter of known fields.
 *
 * Behavior:
 * - JSON only at the edge. Success payload:
 *     { ok: true, id: "<envServiceId>", doc: <dtoJson> }
 * - 404 when not found, with Ops guidance.
 *
 * Invariants:
 * - Self-contained: constructs its own DbReader (no other handlers referenced).
 * - Explicit id mapping: idFieldName="envServiceId".
 */

import { HandlerBase } from "@nv/shared/http/HandlerBase";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";

export class DbReadGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    const dtoCtor = this.ctx.get<any>("read.dtoCtor");
    const idFieldName =
      (this.ctx.get<string>("read.idFieldName") as string) || "envServiceId";

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "READ_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (svcEnv or dtoCtor). Ops: verify controller seeding.",
      });
      return;
    }

    const params = (this.ctx.get("params") as Record<string, unknown>) ?? {};
    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};
    const dtoId = resolveDtoId(params, query, idFieldName);

    const reader = new DbReader<any>({
      dtoCtor,
      svcEnv,
      validateReads: false,
      idFieldName,
    });

    // Instrument target collection (best-effort)
    try {
      const t = await reader.targetInfo();
      this.log.debug(
        { event: "read_target", collection: t.collectionName, pk: idFieldName },
        "read will query collection"
      );
    } catch {
      /* non-fatal */
    }

    if (dtoId) {
      const dto = await reader.readById(dtoId);
      if (!dto) {
        this.ctx.set("handlerStatus", "warn");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: `No record with ${idFieldName}=${dtoId}.`,
        });
        return;
      }
      const j = dto.toJson() as Record<string, unknown>;
      const canonical = (j[idFieldName] as string) ?? (j["envServiceId"] as string);
      this.ctx.set("result", { ok: true, id: canonical, doc: j });
      this.ctx.set("handlerStatus", "ok");
      this.log.debug(
        { event: "read_one_by_id", [idFieldName]: dtoId },
        "read one by id complete"
      );
      return;
    }

    const filter = buildSingleRecordFilter(query);
    const dto = await reader.readOne(filter);
    if (!dto) {
      this.ctx.set("handlerStatus", "warn");
      this.ctx.set("status", 404);
      this.ctx.set("error", {
        code: "NOT_FOUND",
        title: "Not Found",
        detail:
          "Document not found for supplied filter. Ops: verify filter parameters and collection contents.",
      });
      return;
    }

    const j = dto.toJson() as Record<string, unknown>;
    const canonical = (j[idFieldName] as string) ?? (j["envServiceId"] as string);
    this.ctx.set("result", { ok: true, id: canonical, doc: j });
    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      { event: "read_one_by_filter", filterKeys: Object.keys(filter) },
      "read one by filter complete"
    );
  }
}

/* -------------------- local pure helpers (no imports) -------------------- */

function resolveDtoId(
  params: Record<string, unknown>,
  query: Record<string, unknown>,
  idFieldName: string
): string {
  const fromPath =
    (typeof params[idFieldName] === "string" && params[idFieldName].trim()) ||
    (typeof params["id"] === "string" && params["id"].trim()) ||
    "";
  const fromQuery =
    (typeof query[idFieldName] === "string" &&
      (query[idFieldName] as string).trim()) ||
    (typeof query["id"] === "string" && (query["id"] as string).trim()) ||
    "";
  return fromPath || fromQuery;
}

function buildSingleRecordFilter(
  query: Record<string, unknown>
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (typeof query.txtfield1 === "string" && query.txtfield1.trim()) {
    filter.txtfield1 = (query.txtfield1 as string).trim();
  }
  if (typeof query.txtfield2 === "string" && query.txtfield2.trim()) {
    filter.txtfield2 = (query.txtfield2 as string).trim();
  }
  if (query.numfield1 !== undefined) {
    const n1 =
      typeof query.numfield1 === "string"
        ? Number(query.numfield1)
        : (query.numfield1 as number);
    if (Number.isFinite(n1)) filter.numfield1 = n1;
  }
  if (query.numfield2 !== undefined) {
    const n2 =
      typeof query.numfield2 === "string"
        ? Number(query.numfield2)
        : (query.numfield2 as number);
    if (Number.isFinite(n2)) filter.numfield2 = n2;
  }
  return filter;
}
