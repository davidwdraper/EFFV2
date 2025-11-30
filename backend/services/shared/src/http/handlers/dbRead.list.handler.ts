// backend/services/shared/src/http/handlers/dbRead.list.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="_id")
 *
 * Purpose:
 * - Generic list reader used by list-family routes (list, mirror, etc.).
 * - Given:
 *   - ctx["list.dtoCtor"]  → DTO constructor with static fromBody()
 *   - ctx["list.filter"]   → Mongo filter object (Record<string, unknown>)
 *   - ctx["query"]         → { limit?, cursor? } and any other query params
 * - Reads a deterministic batch from Mongo via DbReader and:
 *   - Leaves the resulting DtoBag on ctx["bag"].
 *   - Exposes pagination hints on ctx (e.g., "list.nextCursor", "list.limitUsed").
 *   - Lets ControllerBase.finalize() build the wire payload from bag.toBody().
 *
 * Final-handler invariants (list pipelines):
 * - On success:
 *   - ctx["bag"] MUST contain the DtoBag returned from DbReader.
 *   - ctx["handlerStatus"] MUST be "ok".
 *   - MAY set ctx["list.nextCursor"], ctx["list.limitUsed"] for finalize().
 *   - MUST NOT set ctx["result"].
 *   - MUST NOT set ctx["response.body"] on success.
 * - On error:
 *   - ctx["handlerStatus"] MUST be "error".
 *   - MUST set ctx["response.status"] (HTTP status code).
 *   - MUST set ctx["response.body"] (problem+json-style object).
 *
 * Notes:
 * - Env is obtained via HandlerBase.getVar("NV_MONGO_URI"/"NV_MONGO_DB"),
 *   backed by EnvServiceDto (ADR-0044) for each service.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbReader } from "../../dto/persistence/DbReader";

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "dbRead.list enter");

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
        "list setup missing DTO ctor"
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
        "dbRead.list — target collection"
      );

      const { bag, nextCursor } = await reader.readBatch({
        filter,
        limit,
        cursor,
      });

      // Leave the bag on ctx for finalize() and any downstream handlers.
      this.ctx.set("bag", bag);

      // Pagination hints for finalize().
      this.ctx.set("list.limitUsed", limit);
      if (nextCursor) {
        // Namespaced + generic so finalize() and tests can see it.
        this.ctx.set("list.nextCursor", nextCursor);
        this.ctx.set("nextCursor", nextCursor);
      }

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
      const msg = err?.message ?? String(err ?? "");

      // Special-case bad cursor → client error, not server error.
      if (typeof msg === "string" && msg.startsWith("CURSOR_DECODE_INVALID")) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 400);
        this.ctx.set("response.body", {
          code: "INVALID_CURSOR",
          title: "Invalid Cursor",
          detail: msg,
          requestId,
        });
        this.log.warn(
          {
            event: "invalid_cursor",
            requestId,
            message: msg,
          },
          "dbRead.list — invalid cursor rejected"
        );
      } else {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 500);
        this.ctx.set("response.body", {
          code: "DB_READ_FAILED",
          title: "Internal Error",
          detail: msg,
          requestId,
        });
        this.log.error(
          { event: "list_read_error", err: msg, requestId },
          "dbRead.list — read failed"
        );
      }
    }
  }
}
