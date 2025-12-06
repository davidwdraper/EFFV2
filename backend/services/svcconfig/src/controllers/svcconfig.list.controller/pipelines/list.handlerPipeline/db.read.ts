// backend/services/svcconfig/src/controllers/svcconfig.list.controller/pipelines/list.handlerPipeline/db.Read.ts
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

export class DbReadHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - db.<dbName>.<collectionName>.<op>
   *
   * For svcconfig list:
   * - DB: nv
   * - Collection: svcconfig
   * - Op: read-batch
   */
  public handlerName(): string {
    return "db.nv.svcconfig.read-batch";
  }

  protected handlerPurpose(): string {
    return "Read a paginated batch of svcconfig DTOs via DbReader and expose the resulting DtoBag on ctx['bag'].";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.handlerName(),
        requestId,
      },
      "DbReadHandler.execute list.dbRead enter"
    );

    // --- Required DTO ctor ---------------------------------------------------
    const dtoCtor = this.safeCtxGet<any>("list.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      const error = this.failWithError({
        httpStatus: 500,
        title: "internal_error",
        detail:
          "DTO constructor missing in ctx as 'list.dtoCtor' or missing static fromBody(). Dev: ensure pipeline seeds 'list.dtoCtor' before DbReadHandler.",
        stage: "list.dbRead.dtoCtor",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            key: "list.dtoCtor",
            hasDtoCtor: !!dtoCtor,
            hasFromBody: !!dtoCtor?.fromBody,
          },
        ],
        logMessage:
          "DbReadHandler.execute missing or invalid list.dtoCtor; cannot perform list read",
        logLevel: "error",
      });

      this.ctx.set("response.status", error.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: error.title,
        detail: error.detail,
        status: error.httpStatus,
        code: "DTO_CTOR_MISSING",
        requestId,
      });
      return;
    }

    // --- Env from HandlerBase.getVar (strict, no fallbacks) -----------------
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    if (!mongoUri || !mongoDb) {
      const error = this.failWithError({
        httpStatus: 500,
        title: "internal_error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        stage: "list.dbRead.env",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            keyUri: "NV_MONGO_URI",
            keyDb: "NV_MONGO_DB",
            mongoUriPresent: !!mongoUri,
            mongoDbPresent: !!mongoDb,
          },
        ],
        logMessage:
          "DbReadHandler.execute Mongo env config missing for list read",
        logLevel: "error",
      });

      this.ctx.set("response.status", error.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: error.title,
        detail: error.detail,
        status: error.httpStatus,
        code: "MONGO_ENV_MISSING",
        requestId,
      });
      return;
    }

    // --- Filter + pagination -------------------------------------------------
    const filterRaw = this.safeCtxGet<unknown>("list.filter");
    let filter: Record<string, unknown> = {};

    if (filterRaw !== undefined && filterRaw !== null) {
      if (typeof filterRaw !== "object") {
        const error = this.failWithError({
          httpStatus: 500,
          title: "internal_error",
          detail:
            "list.filter must be an object. Dev: ensure upstream query builder sets a plain object on ctx['list.filter'].",
          stage: "list.dbRead.filter_shape",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              key: "list.filter",
              actualType: typeof filterRaw,
            },
          ],
          logMessage:
            "DbReadHandler.execute received non-object list.filter; treating as error",
          logLevel: "error",
        });

        this.ctx.set("response.status", error.httpStatus);
        this.ctx.set("response.body", {
          type: "about:blank",
          title: error.title,
          detail: error.detail,
          status: error.httpStatus,
          code: "LIST_FILTER_INVALID",
          requestId,
        });
        return;
      }

      filter = filterRaw as Record<string, unknown>;
    }

    const qRaw = this.safeCtxGet<unknown>("query");
    let query: Record<string, unknown> = {};
    if (qRaw !== undefined && qRaw !== null) {
      if (typeof qRaw !== "object") {
        const error = this.failWithError({
          httpStatus: 400,
          title: "bad_request",
          detail:
            "Query payload must be an object with simple key/value pairs. Ops: inspect client usage of svcconfig list endpoint.",
          stage: "list.dbRead.query_shape",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              key: "query",
              expected: "object",
              actualType: typeof qRaw,
            },
          ],
          logMessage:
            "DbReadHandler.execute received non-object query payload; returning 400",
          logLevel: "warn",
        });

        this.ctx.set("response.status", error.httpStatus);
        this.ctx.set("response.body", {
          type: "about:blank",
          title: error.title,
          detail: error.detail,
          status: error.httpStatus,
          code: "QUERY_INVALID",
          requestId,
        });
        return;
      }

      query = qRaw as Record<string, unknown>;
    }

    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 1000;
    let limit = DEFAULT_LIMIT;

    if (query.limit !== undefined) {
      const n =
        typeof query.limit === "string"
          ? Number(query.limit)
          : (query.limit as number);
      if (Number.isFinite(n) && n > 0) {
        limit = Math.min(Math.trunc(n), MAX_LIMIT);
      } else {
        this.log.warn(
          {
            event: "limit_not_numeric",
            handler: this.handlerName(),
            value: query.limit,
            requestId,
          },
          "DbReadHandler.execute ignoring non-numeric limit; using defaults"
        );
      }
    }

    const cursor =
      typeof query.cursor === "string" && query.cursor.trim()
        ? query.cursor.trim()
        : null;

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
          handler: this.handlerName(),
          collection: tgt.collectionName,
          limit,
          hasCursor: !!cursor,
          requestId,
        },
        "DbReadHandler.execute list.dbRead — target collection"
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
        typeof (bag as any).count === "function"
          ? (bag as any).count()
          : Array.from((bag as any).items?.() ?? []).length;

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "list_batch_complete",
          handler: this.handlerName(),
          count,
          hasNext: !!nextCursor,
          limit,
          requestId,
        },
        "DbReadHandler.execute list batch read complete"
      );
    } catch (rawError: any) {
      const error = this.failWithError({
        httpStatus: 500,
        title: "db_read_failed",
        detail:
          "Database batch read for svcconfig list failed unexpectedly. Ops: inspect logs for handler, collection, and requestId.",
        stage: "list.dbRead.readBatch",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hint: "Check Mongo connectivity, collection indexes, and reader configuration.",
          },
        ],
        rawError,
        logMessage:
          "DbReadHandler.execute unhandled exception during svcconfig list DbReader.readBatch()",
        logLevel: "error",
      });

      this.ctx.set("response.status", error.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "Internal Error",
        detail: error.detail,
        status: error.httpStatus,
        code: "DB_READ_FAILED",
        requestId,
      });
    }
  }
}
