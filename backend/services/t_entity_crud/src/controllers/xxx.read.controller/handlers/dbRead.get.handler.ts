// backend/services/t_entity_crud/src/controllers/xxx.read.controller/handlers/dbRead.get.handler.ts
/**
 * Docs:
 * - ADR-0040/41/42/43/44/48/50
 *
 * Purpose:
 * - Single-record read by **primary key only** ("id", string).
 *
 * Behavior:
 * - Success (200): returns DtoBag envelope
 *   { items: [dtoJson], meta: { cursor:null, limit:1, total:1, requestId } }
 * - Missing id (400): { code:"BAD_REQUEST_MISSING_ID", detail:"..." }
 * - Not found (404): { items: [], meta: { cursor:null, limit:1, total:0, requestId } }
 *
 * Invariants:
 * - Canonical id field is strictly "id". No fallbacks. No filter path.
 * - Self-contained: constructs its own DbReader.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import type { IDto } from "@nv/shared/dto/IDto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";

export class DbReadGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    const dtoCtor = this.ctx.get<any>("read.dtoCtor");

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "READ_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (svcEnv or dtoCtor). Ops: verify controller seeding.",
      });
      return;
    }

    const params = (this.ctx.get("params") as Record<string, unknown>) ?? {};
    const query = (this.ctx.get("query") as Record<string, unknown>) ?? {};
    const requestId =
      (this.ctx.get<string>("requestId") as string) || "unknown";

    const id =
      (typeof params["id"] === "string" && params["id"].trim()) ||
      (typeof query["id"] === "string" && (query["id"] as string).trim()) ||
      "";

    if (!id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_MISSING_ID",
        title: "Bad Request",
        detail:
          "Route requires an 'id' path or query parameter. Example: GET /api/xxx/v1/read/<id>",
        requestId,
      });
      return;
    }

    const reader = new DbReader<any>({
      dtoCtor,
      svcEnv,
      validateReads: false,
      idFieldName: "id",
    });

    // Instrument target collection (best-effort)
    try {
      const t = await reader.targetInfo();
      this.log.debug(
        { event: "read_target", collection: t.collectionName, pk: "id" },
        "read will query collection"
      );
    } catch {
      /* non-fatal */
    }

    const dto = await reader.readById(id);
    if (!dto) {
      this.ctx.set("handlerStatus", "warn");
      this.ctx.set("response.status", 404);
      this.ctx.set("response.body", {
        items: [],
        meta: { cursor: null, limit: 1, total: 0, requestId },
      });
      this.log.debug(
        { event: "read_one_by_id_not_found", id },
        "no record by id"
      );
      return;
    }

    const { bag, meta } = BagBuilder.fromDtos([dto], {
      requestId,
      limit: 1,
      total: 1,
      cursor: null,
    });

    // bag.items is an iterator method — invoke and materialize before map
    const itemJson = Array.from(bag.items()).map((d: IDto) => d.toJson());

    this.ctx.set("response.status", 200);
    this.ctx.set("response.body", { items: itemJson, meta });
    this.ctx.set("handlerStatus", "ok");
    this.log.debug({ event: "read_one_by_id", id }, "read one by id complete");
  }
}
