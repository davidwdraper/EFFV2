// backend/services/env-service/src/controllers/list.controller/list.pipeline/db.read.list.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *   - ADR-0048 (DbReader/DbWriter contracts)
 *   - ADR-0050 (Wire Bag Envelope — canonical id="id")
 *   - ADR-0056 (Typed routes use :dtoType; handler resolves ctor via Registry)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Use DbReader<TDto> to fetch a deterministic batch with cursor pagination.
 * - Leave the resulting DtoBag on ctx["bag"] for ControllerBase.finalize()
 *   to build the wire payload via bag.toBody().
 *
 * Invariants:
 * - On success:
 *   - Set ctx["bag"] to the DtoBag returned by DbReader.
 *   - Set handlerStatus="ok".
 *   - Do NOT set ctx["result"] or ctx["response.body"].
 * - On error:
 *   - Use HandlerBase.failWithError(...) for problem+json responses.
 *
 * Notes:
 * - Pull DB config via runtime rails (HandlerBase.getMongoConfig()).
 * - Resolve dtoCtor via DtoRegistry + ctx["dtoType"] (no dtoCtor on ctx required).
 * - Pagination metadata is exposed on ctx for finalize() (e.g., ctx["list.nextCursor"]).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBase } from "@nv/shared/dto/DtoBase";

type DtoCtorWithCollection<T> = {
  fromBody: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string;
  name?: string;
};

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.read.list";
  }

  protected handlerPurpose(): string {
    return "Read a paged DtoBag for env-service list via DbReader using dtoType, list.filter, and cursor/limit from ctx.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug({ event: "execute_start", requestId }, "db.read.list enter");

    // ---- dtoType & Registry ------------------------------------------------
    const dtoType = this.safeCtxGet<string>("dtoType") ?? "";
    if (!dtoType) {
      this.failWithError({
        httpStatus: 400,
        title: "missing_dto_type",
        detail:
          "Missing required path parameter ':dtoType'. Call GET /api/:slug/v:version/:dtoType/list.",
        stage: "db.read.list:missing_dtoType",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "db.read.list: missing dtoType path segment (:dtoType).",
        logLevel: "warn",
      });
      return;
    }

    const registry = this.controller.getDtoRegistry();
    let dtoCtor: DtoCtorWithCollection<DtoBase>;
    try {
      dtoCtor = registry.resolveCtorByType(
        dtoType
      ) as unknown as DtoCtorWithCollection<DtoBase>;
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "unknown_dto_type",
        detail:
          err instanceof Error
            ? err.message
            : `Unable to resolve DTO constructor for dtoType '${dtoType}'.`,
        stage: "db.read.list:resolve_dtoCtor",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "db.read.list: failed to resolve dtoCtor via registry.resolveCtorByType.",
        logLevel: "warn",
      });
      return;
    }

    // ---- DB config (runtime rails) ----------------------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // ---- Filter + pagination params from ctx ------------------------------
    const filter =
      this.safeCtxGet<Record<string, unknown>>("list.filter") ?? {};
    const q = this.safeCtxGet<Record<string, unknown>>("query") ?? {};

    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 1000;

    let limit = DEFAULT_LIMIT;
    if (q.limit !== undefined) {
      const n =
        typeof q.limit === "string" ? Number(q.limit) : (q.limit as number);
      if (Number.isInteger(n) && n > 0) {
        limit = Math.min(n, MAX_LIMIT);
      }
    }

    const cursor =
      typeof q.cursor === "string" && q.cursor.trim() ? q.cursor.trim() : null;

    // ---- External edge: DB read -------------------------------------------
    try {
      const reader = new DbReader<DtoBase>({
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

      this.ctx.set("bag", bag);
      this.ctx.set("list.nextCursor", nextCursor);
      this.ctx.set("list.limitUsed", limit);

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "list_batch_complete",
          itemCount: Array.from(bag.items()).length,
          hasNext: !!nextCursor,
          limit,
          requestId,
        },
        "db.read.list: batch read complete"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_read_failed",
        detail:
          err instanceof Error
            ? err.message
            : "Database read failed while fetching env-service list.",
        stage: "db.read.list:readBatch",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage: "db.read.list: DbReader.readBatch() threw unexpectedly.",
        logLevel: "error",
      });
      return;
    }

    this.log.debug({ event: "execute_end", requestId }, "db.read.list exit");
  }
}
