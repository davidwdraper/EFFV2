// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/db.readExisting.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Build DbReader<TDto> and load existing doc by canonical ctx["id"].
 * - Returns a DtoBag (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :envServiceId)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<TDto>  (size 0 or 1)
 * - "dbReader": DbReader<TDto>
 *
 * Invariants:
 * - Handlers never touch process.env, never touch Express, never build wire.
 * - Mongo config must come from HandlerBase.getMongoConfig() (sandbox-driven).
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class DbReadExistingHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "db.read.existingById";
  }

  protected handlerPurpose(): string {
    return "Load existing record by ctx['id'] into ctx['existingBag'] (0..1) without touching ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    // --- Required id ---------------------------------------------------------
    const idRaw = this.safeCtxGet<unknown>("id");
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    if (!id) {
      this.failWithError({
        httpStatus: 400,
        title: "missing_id",
        detail:
          "Path param ':id' is required. Example: PATCH /api/env-service/v1/:dtoType/update/:id with JSON body of fields to update.",
        stage: "db.read.existingById:params.id",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.update.db.readExisting: ctx['id'] missing/empty.",
        logLevel: "warn",
      });
      return;
    }

    // --- Required dtoCtor ----------------------------------------------------
    const dtoCtor = this.safeCtxGet<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing/invalid in ctx['update.dtoCtor'] (must include static fromBody()). Ops: verify update pipeline wiring.",
        stage: "db.read.existingById:config.dtoCtor",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasDtoCtor: !!dtoCtor, hasFromBody: !!dtoCtor?.fromBody }],
        logMessage:
          "env-service.update.db.readExisting: ctx['update.dtoCtor'] missing/invalid.",
        logLevel: "error",
      });
      return;
    }

    // ---- Missing DB config throws ------------------------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    const validateReads =
      this.safeCtxGet<boolean>("update.validateReads") ?? false;

    const reader = new DbReader<any>({
      dtoCtor,
      mongoUri,
      mongoDb,
      validateReads,
    });

    this.ctx.set("dbReader", reader);

    let existingBag: DtoBag<IDto>;
    try {
      existingBag = (await reader.readOneBagById({ id })) as DtoBag<IDto>;
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "db_read_by_id_failed",
        detail:
          (err as Error)?.message ??
          "Database read failed while fetching existing document by id.",
        stage: "db.read.existingById:db.readOneBagById",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.update.db.readExisting: readOneBagById() threw unexpectedly.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set("existingBag", existingBag);

    const size = Array.from(existingBag.items()).length;
    if (size === 0) {
      this.failWithError({
        httpStatus: 404,
        title: "not_found",
        detail:
          "No document found for supplied :id. Confirm the id from create/read response and ensure you are hitting the correct collection.",
        stage: "db.read.existingById:notFound",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.update.db.readExisting: no document found for supplied id.",
        logLevel: "warn",
      });
      return;
    }

    if (size > 1) {
      // Primary key lookup must be singleton — if it isn’t, something is seriously wrong.
      this.failWithError({
        httpStatus: 500,
        title: "multiple_matches",
        detail:
          "Invariant breach: multiple records matched primary key lookup. Ops: check unique index on _id and upstream normalization.",
        stage: "db.read.existingById:singletonBreach",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [{ id, count: size }],
        logMessage:
          "env-service.update.db.readExisting: multiple records matched id lookup.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set("handlerStatus", "ok");
  }
}
