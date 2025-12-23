// backend/services/env-service/src/controllers/read.controller/pipelines/read.pipeline/dbRead.get.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0048 (DbReader contract)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id is DTO.id)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Single-record read by primary key only ("id", string).
 *
 * Invariants:
 * - Canonical success output is ctx["bag"] (DtoBag) for finalize().
 * - No handler may build wire payloads (no ctx["response.body"] on success).
 * - dtoCtor is seeded by the pipeline via ctx["read.dtoCtor"].
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import { DtoBag as DtoBagClass } from "@nv/shared/dto/DtoBag";

export class DbReadGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.read.byId";
  }

  protected handlerPurpose(): string {
    return "Read a single record by id into ctx['bag'] for finalize() (env-service read pipeline).";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    // dtoCtor is intentionally per-route seed via ctx (controller/pipeline decides which DTO)
    const dtoCtor = this.safeCtxGet<any>("read.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "read_setup_missing",
        detail:
          "Required context missing or invalid (read.dtoCtor). Ops: ensure the read pipeline seeds ctx['read.dtoCtor'] with a DTO ctor that implements fromBody().",
        stage: "db.read.byId:setup",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasDtoCtor: !!dtoCtor, hasFromBody: !!dtoCtor?.fromBody }],
        logMessage:
          "env-service.read.dbRead.get: missing/invalid ctx['read.dtoCtor']; cannot construct DbReader.",
        logLevel: "error",
      });
      return;
    }

    const params =
      (this.safeCtxGet<any>("params") as Record<string, unknown>) ?? {};
    const query =
      (this.safeCtxGet<any>("query") as Record<string, unknown>) ?? {};

    const id =
      (typeof params.id === "string" && params.id.trim()) ||
      (typeof query.id === "string" && query.id.trim()) ||
      "";

    if (!id) {
      // Typed rails: use failWithError so finalize stays the single response builder.
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_missing_id",
        detail:
          "Route requires an 'id' path or query parameter. Example: GET /api/env-service/v1/:dtoType/read/:id.",
        stage: "db.read.byId:params.id",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.read.dbRead.get: missing 'id' in path or query.",
        logLevel: "warn",
      });
      return;
    }

    // Missing DB config throws; HandlerBase wraps.
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    const reader = new DbReader<any>({
      dtoCtor,
      mongoUri,
      mongoDb,
      validateReads: false,
    });

    // Best-effort: introspection log only.
    try {
      const t = await reader.targetInfo();
      this.log.debug(
        {
          event: "read_target",
          collection: t.collectionName,
          pk: "id",
          requestId,
        },
        "env-service.read.dbRead.get: read will query collection"
      );
    } catch {
      /* best-effort */
    }

    try {
      // Bag-centric read
      const bag = (await reader.readOneBagById({ id })) as DtoBag<IDto>;

      const size = Array.from(bag.items()).length;
      if (size === 0) {
        // Not found is not an error envelope here; it is an error status with a bag for finalize().
        // Finalize can decide whether to emit empty bag or problem body; handler just declares status.
        this.ctx.set("status", 404);

        // Ensure finalize invariant: ctx["bag"] exists.
        this.ctx.set("bag", bag);

        this.ctx.set("handlerStatus", "error");
        return;
      }

      // Success: leave bag on ctx and let finalize build the wire envelope.
      this.ctx.set("bag", bag);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        { event: "read_one_by_id_ok", id, requestId },
        "env-service.read.dbRead.get: read one by id complete"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_read_failed",
        detail:
          "Database read failed while trying to fetch a record by id. Ops: inspect handler logs by requestId; confirm Mongo connectivity, indexes, and collection wiring.",
        stage: "db.read.byId:db.read",
        requestId,
        origin: { file: __filename, method: "execute" },
        rawError: err,
        logMessage:
          "env-service.read.dbRead.get: DbReader.readOneBagById threw.",
        logLevel: "error",
      });
      return;
    }
  }
}
