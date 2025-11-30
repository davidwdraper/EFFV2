// backend/services/user/src/controllers/user.list.controller/handlers/dbRead.list.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id")
 *
 * Purpose:
 * - Use DbReader<UserDto> to fetch a deterministic batch with cursor pagination.
 * - Return { ok, docs, nextCursor } (docs via DTO.toBody()).
 *
 * Notes:
 * - Env is obtained via HandlerBase.getVar("NV_MONGO_URI"/"NV_MONGO_DB")
 *   which is backed by the service's EnvServiceDto (ADR-0044).
 * - DTO ctor is supplied via ctx["list.dtoCtor"] by the pipeline.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { DtoBagView } from "@nv/shared/dto/DtoBagView";

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "list.dbRead enter");

    // --- Required DTO ctor ---------------------------------------------------
    const dtoCtor = this.ctx.get<any>("list.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DTO_CTOR_MISSING",
        title: "Internal Error",
        detail:
          "DTO constructor missing in ctx as 'list.dtoCtor' or missing static fromBody().",
      });
      this.log.error(
        { event: "dtoCtor_missing", hasDtoCtor: !!dtoCtor },
        "List setup missing DTO ctor"
      );
      return;
    }

    // --- Env from HandlerBase.getVar (strict, no fallbacks) -----------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
        },
        "list aborted — Mongo env config missing"
      );
      return;
    }

    // --- Filter + pagination -------------------------------------------------
    const filter =
      (this.ctx.get("list.filter") as Record<string, unknown>) ?? {};
    const q = (this.ctx.get("query") as Record<string, unknown>) ?? {};

    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 1000;
    let limit = DEFAULT_LIMIT;

    if (q.limit !== undefined) {
      const n =
        typeof q.limit === "string" ? Number(q.limit) : (q.limit as number);
      if (Number.isFinite(n) && n > 0) {
        limit = Math.min(Math.trunc(n), MAX_LIMIT);
      }
    }

    const cursor =
      typeof q.cursor === "string" && q.cursor.trim() ? q.cursor.trim() : null;

    // --- Reader + batch read -------------------------------------------------
    const reader = new DbReader<any>({
      dtoCtor,
      mongoUri,
      mongoDb,
      validateReads: false,
    });

    const { bag, nextCursor } = await reader.readBatch({
      filter,
      limit,
      cursor,
    });

    // Canonical list shape: docs[] = DTO.toBody()
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
