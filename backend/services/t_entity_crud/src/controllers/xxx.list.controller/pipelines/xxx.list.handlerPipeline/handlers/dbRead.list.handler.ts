// backend/services/t_entity_crud/src/controllers/xxx.list.controller/handlers/dbRead.list.handler.ts
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
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *
 * Purpose:
 * - Use DbReader<XxxDto> to fetch a deterministic batch with cursor pagination.
 * - Return { ok, docs, nextCursor } (docs via DTO.toJson()).
 *
 * Notes:
 * - Pull svcEnv from ControllerBase (no ctx plumbing), then derive mongoUri/mongoDb.
 * - Still accepts dtoCtor via ctx (controller-specific).
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
    // svcEnv via ControllerBase getter
    const svcEnv = this.controller.getSvcEnv?.();
    const dtoCtor = this.ctx.get<any>("list.dtoCtor");

    if (!svcEnv || !dtoCtor) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "LIST_SETUP_MISSING",
        title: "Internal Error",
        detail:
          "Required setup missing (svcEnv from ControllerBase or list.dtoCtor from controller).",
      });
      this.log.error(
        { event: "setup_missing", hasSvcEnv: !!svcEnv, hasDtoCtor: !!dtoCtor },
        "List setup missing"
      );
      return;
    }

    // Derive Mongo connection info from svcEnv (ADR-0044; tolerant to shape)
    const svcEnvAny: any = svcEnv;
    const vars = svcEnvAny?.vars ?? svcEnvAny ?? {};
    const mongoUri: string | undefined =
      vars.NV_MONGO_URI ?? vars["NV_MONGO_URI"];
    const mongoDb: string | undefined = vars.NV_MONGO_DB ?? vars["NV_MONGO_DB"];

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service for NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv: !!svcEnv,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
        },
        "List aborted — Mongo env config missing"
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
      if (Number.isFinite(n) && n > 0) {
        limit = Math.min(Math.trunc(n), MAX_LIMIT);
      }
    }

    const cursor =
      typeof q.cursor === "string" && q.cursor.trim() ? q.cursor.trim() : null;

    // New DbReader contract: use mongoUri/mongoDb instead of svcEnv
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
