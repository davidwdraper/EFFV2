// backend/services/env-service/src/controllers/list.controller/list.pipeline/dbRead.handler.ts
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
 *   to build the wire payload via bag.toJson().
 *
 * Invariants:
 * - On success:
 *   - Set ctx["bag"] to the DtoBag returned by DbReader.
 *   - Set handlerStatus="ok".
 *   - Do NOT set ctx["result"] or ctx["response.body"].
 * - On error:
 *   - Set handlerStatus="error".
 *   - Set ctx["response.status"] and ctx["response.body"] (problem+json).
 *
 * Notes:
 * - Pull env config via HandlerBase.getVar (SvcEnv-driven).
 * - Resolve dtoCtor via DtoRegistry + ctx["dtoType"] (no dtoCtor on ctx required).
 * - Pagination metadata (e.g., nextCursor) is exposed on ctx for finalize()
 *   to incorporate into the wire envelope (e.g., ctx["list.nextCursor"]).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import type { DtoBase } from "@nv/shared/dto/DtoBase";

type DtoCtorWithCollection<T> = {
  fromJson: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string;
  name?: string;
};

export class DbReadListHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_start" }, "list.dbRead enter");

    const requestId = this.ctx.get("requestId");

    // ---- dtoType & Registry --------------------------------------------------
    const dtoType = this.ctx.get<string>("dtoType") ?? "";

    if (!dtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        hint: "Call GET /api/:slug/v:version/:dtoType/list",
        requestId,
      });
      this.log.warn(
        { event: "bad_request", reason: "no_dtoType" },
        "list.dbRead — missing :dtoType"
      );
      return;
    }

    const registry = this.controller.getDtoRegistry?.();
    if (!registry || typeof registry.resolveCtorByType !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "REGISTRY_MISSING",
        title: "Internal Error",
        detail:
          "DtoRegistry missing or incomplete; cannot resolve DTO constructor for list.",
        hint: "AppBase must expose a DtoRegistry; ControllerBase wires it via getDtoRegistry().",
        requestId,
      });
      this.log.error(
        {
          event: "registry_missing",
          dtoType,
          hasRegistry: !!registry,
        },
        "list.dbRead — registry missing for ctor resolution"
      );
      return;
    }

    let dtoCtor: DtoCtorWithCollection<DtoBase>;
    try {
      dtoCtor = registry.resolveCtorByType(
        dtoType
      ) as unknown as DtoCtorWithCollection<DtoBase>;
    } catch (e: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "UNKNOWN_DTO_TYPE",
        title: "Bad Request",
        detail:
          e?.message ??
          `Unable to resolve DTO constructor for dtoType '${dtoType}'.`,
        hint: "Verify the DtoRegistry contains this dtoType.",
        requestId,
      });
      this.log.warn(
        {
          event: "dto_type_resolve_failed",
          dtoType,
          err: e?.message,
        },
        "list.dbRead — failed to resolve dtoCtor"
      );
      return;
    }

    // ---- Env / Mongo config via HandlerBase.getVar --------------------------
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
        hint: "Check env-service NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
        requestId,
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.constructor.name,
        },
        "list.dbRead aborted — Mongo env config missing"
      );
      return;
    }

    // ---- Filter + pagination params from ctx --------------------------------
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
        },
        "list.dbRead — target collection"
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

      // Success: leave only the bag and metadata; finalize() builds the wire payload.
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "list_batch_complete",
          count: Array.from(bag.items?.() ?? ([] as Iterable<unknown>)).length,
          hasNext: !!nextCursor,
          limit,
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
        hint: "Check Mongo connectivity, collection indexes, and env-service configuration.",
        requestId,
      });
      this.log.error(
        { event: "list_read_error", err: err?.message },
        "list.dbRead — read failed"
      );
    } finally {
      this.log.debug({ event: "execute_end" }, "list.dbRead exit");
    }
  }
}
