// backend/services/t_entity_crud/src/controllers/xxx.list.controller/handlers/dbRead.list.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *
 * Purpose:
 * - Use DbReader<XxxDto> to fetch a deterministic batch with cursor pagination.
 * - Return { ok, docs, nextCursor } (docs via DTO.toJson()).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { DtoBagView } from "@nv/shared/dto/DtoBagView";

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const svcEnv = this.ctx.get<SvcEnvDto>("svcEnv");
    const dtoCtor = this.ctx.get<any>("list.dtoCtor");

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "LIST_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required context missing (svcEnv or list.dtoCtor). Ops: verify ControllerBase.makeContext() and controller seeding.",
      });
      this.log.error(
        { event: "setup_missing", hasSvcEnv: !!svcEnv, hasDtoCtor: !!dtoCtor },
        "List setup missing"
      );
      return;
    }

    const filter =
      (this.ctx.get("list.filter") as Record<string, unknown>) ?? {};
    const q = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 1000;
    let limit = DEFAULT_LIMIT;
    if (q.limit !== undefined) {
      const n =
        typeof q.limit === "string" ? Number(q.limit) : (q.limit as number);
      if (Number.isFinite(n) && n > 0)
        limit = Math.min(Math.trunc(n), MAX_LIMIT);
    }

    const cursor =
      typeof q.cursor === "string" && q.cursor.trim() ? q.cursor.trim() : null;

    const reader = new DbReader<any>({ dtoCtor, svcEnv, validateReads: false });

    const { bag, nextCursor } = await reader.readBatch({
      filter,
      limit,
      cursor,
      // order?: default inside DbReader (_id asc or whatever your adapter enforces)
    });

    const docs = DtoBagView.fromBag(bag).toJsonArray();

    this.ctx.set("result", { ok: true, docs, nextCursor });
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "list_batch_complete",
        count: docs.length,
        hasNext: !!nextCursor,
        limit,
      },
      "list batch read complete"
    );
  }
}
