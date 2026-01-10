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
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0106 (Lazy index ensure via persistence IndexGate)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
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
 * Notes (ADR-0106):
 * - DbReader is runtime-driven:
 *   - DB config comes from SvcRuntime (rt.getDbVar()).
 *   - Index ensure is done lazily via rt.getCap("db.indexGate") before DB ops.
 * - Therefore this handler MUST NOT pull mongoUri/mongoDb itself.
 *
 * ADR-0106 invariant (critical):
 * - Handlers must not reference index concepts or types (including indexHints).
 * - DbReader validates index contracts internally at the DB boundary.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import {
  DbReader,
  type DbReadDtoCtor,
} from "../../dto/persistence/dbReader/DbReader";
import { ControllerBase } from "../../base/controller/ControllerBase";

const ORIGIN_FILE = "backend/services/shared/src/http/handlers/db.read.list.ts";

type ListDtoCtor = DbReadDtoCtor<unknown>;

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
    const requestId = this.getRequestId();

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "dbRead.list enter"
    );

    // --- Required DTO ctor ---------------------------------------------------
    const seeded = this.safeCtxGet<unknown>("list.dtoCtor");

    // NOTE:
    // - DTO classes are functions at runtime.
    // - Accept function OR object to avoid forcing wrappers.
    if (
      !seeded ||
      (typeof seeded !== "function" && typeof seeded !== "object")
    ) {
      const err = this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing in ctx['list.dtoCtor']. Ops: upstream pipeline must set list.dtoCtor to the DTO class.",
        stage: "config.dtoCtor",
        requestId,
        origin: { file: ORIGIN_FILE, method: "execute" },
        issues: [{ hasDtoCtor: !!seeded, type: typeof seeded }],
        logMessage:
          "dbRead.list — DTO ctor missing or invalid (ctx['list.dtoCtor']).",
        logLevel: "error",
      });

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", err.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: err.title,
        status: err.httpStatus,
        code: "DTO_CTOR_MISSING",
        detail: err.detail,
        requestId,
      });
      return;
    }

    const dtoCtor = seeded as unknown as ListDtoCtor;

    // Validate only handler-facing ctor surface (no indexHints here).
    // DbReader enforces the index contract at the DB boundary (ADR-0106).
    if (typeof (dtoCtor as any)?.fromBody !== "function") {
      const err = this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing static fromBody(). Ops: upstream pipeline must set list.dtoCtor to the DTO class.",
        stage: "config.dtoCtor.fromBody",
        requestId,
        origin: { file: ORIGIN_FILE, method: "execute" },
        issues: [{ hasFromBody: false }],
        logMessage:
          "dbRead.list — DTO ctor missing required static fromBody().",
        logLevel: "error",
      });

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", err.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: err.title,
        status: err.httpStatus,
        code: "DTO_CTOR_MISSING",
        detail: err.detail,
        requestId,
      });
      return;
    }

    if (typeof (dtoCtor as any)?.dbCollectionName !== "function") {
      const err = this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing_collection",
        detail:
          "DTO ctor missing static dbCollectionName(). Dev: add it on the DTO class.",
        stage: "config.dtoCtor.dbCollectionName",
        requestId,
        origin: { file: ORIGIN_FILE, method: "execute" },
        issues: [{ hasDbCollectionName: false }],
        logMessage:
          "dbRead.list — DTO ctor missing dbCollectionName(); cannot target collection.",
        logLevel: "error",
      });

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", err.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: err.title,
        status: err.httpStatus,
        code: "DTO_CTOR_MISSING_COLLECTION",
        detail: err.detail,
        requestId,
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
        rt: this.rt,
        dtoCtor,
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
    } catch (rawError) {
      const msg =
        (rawError as Error)?.message ??
        (typeof rawError === "string" ? rawError : String(rawError ?? ""));

      // Special-case bad cursor → client error, not server error.
      const isBadCursor =
        typeof msg === "string" && msg.startsWith("CURSOR_DECODE_INVALID");

      const err = this.failWithError({
        httpStatus: isBadCursor ? 400 : 500,
        title: isBadCursor ? "invalid_cursor" : "db_read_failed",
        detail: msg,
        stage: isBadCursor ? "db.readBatch.cursorDecode" : "db.readBatch",
        requestId,
        origin: {
          file: ORIGIN_FILE,
          method: "execute",
          collection: collectionName || undefined,
        },
        issues: [
          {
            cursor,
            limit,
            filter: isBadCursor ? undefined : filter,
          },
        ],
        rawError,
        logMessage: isBadCursor
          ? "dbRead.list — invalid cursor rejected (CURSOR_DECODE_INVALID...)."
          : "dbRead.list — unexpected error during DbReader.readBatch().",
        logLevel: isBadCursor ? "warn" : "error",
      });

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", err.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: err.title,
        status: err.httpStatus,
        code: isBadCursor ? "INVALID_CURSOR" : "DB_READ_FAILED",
        detail: err.detail,
        requestId,
      });

      return;
    }
  }
}
