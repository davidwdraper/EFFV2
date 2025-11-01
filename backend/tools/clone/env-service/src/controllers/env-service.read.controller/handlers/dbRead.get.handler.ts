// backend/services/env-service/src/controllers/env-service.read.controller/handlers/dbRead.get.handler.ts
/**
 * Docs:
 * - ADR-0040/41/42/43/44/48
 *
 * Purpose:
 * - Execute a single-record read:
 *   1) If an id is provided (path param or query), use DbReader.readById()
 *   2) Else, build a safe single-record filter from known fields and use readOne(filter)
 *
 * Behavior:
 * - JSON only at the edge: dto.toJson() for success
 * - 404 Not Found if no matching record
 * - Provides Ops guidance in error details
 *
 * Invariants:
 * - Handlers speak DTO-space only (envServiceId:string). Mongo details are hidden in DbReader.
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

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "READ_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (svcEnv or dtoCtor). Ops: verify ControllerBase.makeContext() and EnvServiceReadController seeding.",
      });
      return;
    }

    const params = (this.ctx.get("params") as Record<string, unknown>) ?? {};
    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    // Accept id from either :envServiceId or legacy :id (path wins), fall back to ?envServiceId or ?id
    const idFromPath =
      (typeof params["envServiceId"] === "string" && params["envServiceId"].trim()) ||
      (typeof params["id"] === "string" && params["id"].trim()) ||
      "";
    const idFromQuery =
      (typeof query["envServiceId"] === "string" &&
        (query["envServiceId"] as string).trim()) ||
      (typeof query["id"] === "string" && (query["id"] as string).trim()) ||
      "";
    const id = idFromPath || idFromQuery;

    const reader = new DbReader<any>({ dtoCtor, svcEnv, validateReads: false });

    // Instrument the resolved read target (collection) once per request
    try {
      const t = await reader.targetInfo();
      this.log.debug(
        { event: "read_target", collection: t.collectionName, pk: "envServiceId" },
        "read will query collection"
      );
    } catch {
      // ignore; failure to introspect target isn't fatal
    }

    // 1) Prefer read-by-id if supplied (DTO-space id)
    if (id) {
      const dto = await reader.readById(id);
      if (!dto) {
        this.ctx.set("handlerStatus", "warn");
        this.ctx.set("status", 404);
        this.ctx.set("error", {
          code: "NOT_FOUND",
          title: "Not Found",
          detail: `No record with envServiceId=${id}. Source=${
            idFromPath ? "path:envServiceId" : "query:envServiceId"
          }.`,
        });
        return;
      }
      this.ctx.set("result", { ok: true, doc: dto.toJson() });
      this.ctx.set("handlerStatus", "ok");
      this.log.debug(
        { event: "read_one_by_id", envServiceId: id },
        "read one by id complete"
      );
      return;
    }

    // 2) Optional single-record filter read (tight filter only on known fields)
    const filter: Record<string, unknown> = {};
    if (typeof query.txtfield1 === "string" && query.txtfield1.trim()) {
      filter.txtfield1 = (query.txtfield1 as string).trim();
    }
    if (typeof query.txtfield2 === "string" && query.txtfield2.trim()) {
      filter.txtfield2 = (query.txtfield2 as string).trim();
    }
    if (query.numfield1 !== undefined) {
      const n =
        typeof query.numfield1 === "string"
          ? Number(query.numfield1)
          : (query.numfield1 as number);
      if (Number.isFinite(n)) filter.numfield1 = n;
    }
    if (query.numfield2 !== undefined) {
      const n =
        typeof query.numfield2 === "string"
          ? Number(query.numfield2)
          : (query.numfield2 as number);
      if (Number.isFinite(n)) filter.numfield2 = n;
    }

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

    this.ctx.set("result", { ok: true, doc: dto.toJson() });
    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      { event: "read_one_by_filter", filterKeys: Object.keys(filter) },
      "read one by filter complete"
    );
  }
}
