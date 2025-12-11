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
 * - Pull env config via HandlerBase.getVar (SvcEnv-driven).
 * - Resolve dtoCtor via DtoRegistry + ctx["dtoType"] (no dtoCtor on ctx required).
 * - Pagination metadata (e.g., nextCursor) is exposed on ctx for finalize()
 *   to incorporate into the wire envelope (e.g., ctx["list.nextCursor"]).
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

  protected handlerPurpose(): string {
    return "Read a paged DtoBag for env-service list via DbReader using dtoType, list.filter, and cursor/limit from ctx.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "execute_start", requestId },
      "env-service.list.dbRead: enter"
    );

    try {
      // ---- dtoType & Registry ------------------------------------------------
      const dtoType = this.ctx.get<string>("dtoType") ?? "";

      if (!dtoType) {
        this.failWithError({
          httpStatus: 400,
          title: "missing_dto_type",
          detail:
            "Missing required path parameter ':dtoType'. Call GET /api/:slug/v:version/:dtoType/list.",
          stage: "list.dbRead.dtoType.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.list.dbRead: missing dtoType path segment (:dtoType).",
          logLevel: "warn",
        });
        return;
      }

      const registry = this.controller.getDtoRegistry?.();
      if (!registry || typeof registry.resolveCtorByType !== "function") {
        this.failWithError({
          httpStatus: 500,
          title: "dto_registry_missing",
          detail:
            "DtoRegistry missing or incomplete; cannot resolve DTO constructor for list.",
          stage: "list.dbRead.registry.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.list.dbRead: DtoRegistry missing or does not implement resolveCtorByType.",
          logLevel: "error",
        });
        return;
      }

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
            (err as Error)?.message ??
            `Unable to resolve DTO constructor for dtoType '${dtoType}'.`,
          stage: "list.dbRead.dtoType.resolve",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.list.dbRead: failed to resolve dtoCtor via registry.resolveCtorByType.",
          logLevel: "warn",
        });
        return;
      }

      // ---- Missing DB config throws ------------------------
      const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

      // ---- Filter + pagination params from ctx ------------------------------
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
        typeof q.cursor === "string" && q.cursor.trim()
          ? q.cursor.trim()
          : null;

      try {
        const reader = new DbReader<DtoBase>({
          dtoCtor,
          mongoUri,
          mongoDb,
          validateReads: false,
        });

        // Introspection: which collection did we actually hit?
        const tgt = await reader.targetInfo();
        this.log.debug(
          {
            event: "list_target",
            collection: tgt.collectionName,
            dtoType,
            limit,
            hasCursor: !!cursor,
            requestId,
          },
          "env-service.list.dbRead: resolved target collection"
        );

        const { bag, nextCursor } = await reader.readBatch({
          filter,
          limit,
          cursor,
        });

        // Expose the bag on ctx for finalize() and any downstream handlers.
        this.ctx.set("bag", bag);

        // Expose pagination metadata for finalize() to include in the wire envelope.
        this.ctx.set("list.nextCursor", nextCursor);
        this.ctx.set("list.limitUsed", limit);

        this.ctx.set("handlerStatus", "ok");

        this.log.debug(
          {
            event: "list_batch_complete",
            // Avoid consuming the iterator if items() is a generator with side effects
            count: Array.from(bag.items?.() ?? ([] as Iterable<unknown>))
              .length,
            hasNext: !!nextCursor,
            limit,
            requestId,
          },
          "env-service.list.dbRead: batch read complete"
        );
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "db_read_failed",
          detail:
            (err as Error)?.message ??
            "Database read failed while fetching env-service list.",
          stage: "list.dbRead.readBatch",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.list.dbRead: DbReader.readBatch() threw unexpectedly.",
          logLevel: "error",
        });
        return;
      }
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "env_service_list_handler_failure",
        detail:
          "Unhandled exception while executing env-service list DB read. Ops: inspect logs for requestId and stack frame.",
        stage: "list.dbRead.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.list.dbRead: unhandled exception in handler execute().",
        logLevel: "error",
      });
    } finally {
      this.log.debug(
        { event: "execute_end", requestId },
        "env-service.list.dbRead: exit"
      );
    }
  }
}
