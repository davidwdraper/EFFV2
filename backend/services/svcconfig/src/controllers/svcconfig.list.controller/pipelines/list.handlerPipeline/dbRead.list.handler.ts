// backend/services/svcconfig/src/controllers/svcconfig.list.controller/handlers/dbRead.list.handler.ts
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
 * - Use DbReader<TDto> to fetch a deterministic batch with cursor pagination.
 * - Leave the resulting DtoBag on ctx["bag"]; ControllerBase.finalize()
 *   is responsible for building the wire payload (docs, meta, nextCursor).
 *
 * Final-handler invariants (list pipelines):
 * - On success:
 *   - ctx["bag"] MUST contain the DtoBag returned from DbReader.
 *   - MAY expose pagination hints (e.g., ctx["list.nextCursor"], ctx["list.limitUsed"]).
 *   - ctx["handlerStatus"] MUST be "ok".
 *   - MUST NOT set ctx["result"].
 *   - MUST NOT set ctx["response.body"] on success.
 * - On error:
 *   - ctx["handlerStatus"] MUST be "error".
 *   - MUST set ctx["response.status"] (HTTP status).
 *   - MUST set ctx["response.body"] (problem+json-style object).
 *
 * Notes:
 * - Env is obtained via HandlerBase.getVar("NV_MONGO_URI"/"NV_MONGO_DB")
 *   which is backed by the service's EnvServiceDto (ADR-0044).
 * - DTO ctor is supplied via ctx["list.dtoCtor"] by the pipeline.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "list.dbRead enter");

    const requestId =
      (this.ctx.get<string>("requestId") as string | undefined) ?? "unknown";

    // --- Required DTO ctor ---------------------------------------------------
    const dtoCtor = this.ctx.get<any>("list.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DTO_CTOR_MISSING",
        title: "Internal Error",
        detail:
          "DTO constructor missing in ctx as 'list.dtoCtor' or missing static fromBody().",
        requestId,
      });
      this.log.error(
        { event: "dtoCtor_missing", hasDtoCtor: !!dtoCtor, requestId },
        "List setup missing DTO ctor"
      );
      return;
    }

    // --- Env from HandlerBase.getVar (strict, no fallbacks) -----------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        requestId,
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          requestId,
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

    try {
      // --- Reader + batch read -----------------------------------------------
      const reader = new DbReader<any>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads: false,
      });

      const tgt = await reader.targetInfo();
      this.log.debug(
        {
          event: "list_target",
          collection: tgt.collectionName,
          limit,
          hasCursor: !!cursor,
          requestId,
        },
        "list.dbRead — target collection"
      );

      const { bag, nextCursor } = await reader.readBatch({
        filter,
        limit,
        cursor,
      });

      // Leave the bag and pagination hints on ctx; finalize() will turn this into wire JSON.
      this.ctx.set("bag", bag);
      this.ctx.set("list.nextCursor", nextCursor);
      this.ctx.set("list.limitUsed", limit);

      const count =
        typeof bag.count === "function"
          ? bag.count()
          : Array.from(bag.items?.() ?? []).length;

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "list_batch_complete",
          count,
          hasNext: !!nextCursor,
          limit,
          requestId,
        },
        "list batch read complete"
      );
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "DB_READ_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        requestId,
      });
      this.log.error(
        { event: "list_read_error", err: err?.message, requestId },
        "list.dbRead — read failed"
      );
    }
  }
}
