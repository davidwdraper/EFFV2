// backend/services/shared/src/http/handlers/db.read.list.ts
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
 *   - ctx["status"] MUST be set (HTTP status code).
 *   - ctx["error"] MUST carry an NvHandlerError (ProblemDetails source).
 *
 * Notes:
 * - Env is obtained via HandlerBase.getVar("NV_MONGO_URI"/"NV_MONGO_DB"),
 *   backed by EnvServiceDto (ADR-0044) for each service.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import { DbReader } from "../../dto/persistence/dbReader/DbReader";
import { ControllerBase } from "../../base/controller/ControllerBase";

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Read a deterministic list batch via DbReader and attach the resulting DtoBag to ctx['bag'] with cursor hints.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "dbRead.list enter"
    );

    // --- Required DTO ctor ---------------------------------------------------
    const dtoCtor = this.safeCtxGet<any>("list.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing in ctx['list.dtoCtor'] or missing static fromBody(). Ops: upstream pipeline must set list.dtoCtor to the DTO class.",
        stage: "config.dtoCtor",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasDtoCtor: !!dtoCtor,
            hasFromBody: !!dtoCtor?.fromBody,
          },
        ],
        logMessage:
          "dbRead.list — DTO ctor missing or invalid (ctx['list.dtoCtor']).",
        logLevel: "error",
      });
      return;
    }

    // --- Env from HandlerBase.getVar (strict, no fallbacks) -----------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      this.failWithError({
        httpStatus: 500,
        title: "mongo_env_missing",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        stage: "config.mongoEnv",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            mongoUriPresent: !!mongoUri,
            mongoDbPresent: !!mongoDb,
          },
        ],
        logMessage:
          "dbRead.list aborted — Mongo env config missing (NV_MONGO_URI / NV_MONGO_DB).",
        logLevel: "error",
      });
      return;
    }

    // --- Filter + pagination -------------------------------------------------
    const filter =
      (this.safeCtxGet("list.filter") as Record<string, unknown>) ?? {};
    const q = (this.safeCtxGet("query") as Record<string, unknown>) ?? {};

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

    // --- Reader + batch read (external edge) --------------------------------
    let collectionName = "";
    try {
      const reader = new DbReader<any>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads: false,
      });

      const tgt = await reader.targetInfo();
      collectionName = tgt.collectionName;

      this.log.debug(
        {
          event: "list_target",
          collection: collectionName,
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
        this.ctx.set("list.nextCursor", nextCursor);
        this.ctx.set("nextCursor", nextCursor);
      }

      const count =
        typeof (bag as any).count === "function"
          ? (bag as any).count()
          : Array.from((bag as any).items?.() ?? []).length;

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "list_batch_complete",
          count,
          hasNext: !!nextCursor,
          limit,
          collection: collectionName,
          requestId,
        },
        "dbRead.list — batch read complete"
      );
    } catch (err) {
      const msg =
        (err as Error)?.message ??
        (typeof err === "string" ? err : String(err ?? ""));

      // Special-case bad cursor → client error, not server error.
      if (typeof msg === "string" && msg.startsWith("CURSOR_DECODE_INVALID")) {
        this.failWithError({
          httpStatus: 400,
          title: "invalid_cursor",
          detail: msg,
          stage: "db.readBatch.cursorDecode",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName || undefined,
          },
          issues: [
            {
              cursor,
              limit,
            },
          ],
          rawError: err,
          logMessage:
            "dbRead.list — invalid cursor rejected (CURSOR_DECODE_INVALID...).",
          logLevel: "warn",
        });
      } else {
        this.failWithError({
          httpStatus: 500,
          title: "db_read_failed",
          detail: msg,
          stage: "db.readBatch",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
            collection: collectionName || undefined,
          },
          issues: [
            {
              cursor,
              limit,
              filter,
            },
          ],
          rawError: err,
          logMessage:
            "dbRead.list — unexpected error during DbReader.readBatch().",
          logLevel: "error",
        });
      }
    }
  }
}
