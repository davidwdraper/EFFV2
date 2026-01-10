// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/db.readExisting.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 * - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 * - ADR-0106 (Lazy index ensure via persistence IndexGate)
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
 * - DB access must go through SvcRuntime (ADR-0106); no mongoUri/mongoDb param sprawl.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import {
  DbReader,
  type DbReadDtoCtor,
} from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

/**
 * ADR-0106:
 * - Handlers must remain ignorant of index logic and IndexGate.
 * - Therefore, handlers must NOT reference indexHints (even in local typing).
 * - DbReader validates the index contract at the DB boundary.
 */
type UpdateDtoCtor = DbReadDtoCtor<IDto>;

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
    const seededCtor = this.safeCtxGet<unknown>("update.dtoCtor") ?? null;

    // NOTE:
    // - DTO classes are functions at runtime.
    // - We accept function OR object to avoid forcing wrappers.
    if (
      !seededCtor ||
      (typeof seededCtor !== "function" && typeof seededCtor !== "object")
    ) {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing/invalid in ctx['update.dtoCtor']. Ops: verify update pipeline wiring.",
        stage: "db.read.existingById:config.dtoCtor",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasDtoCtor: !!seededCtor, type: typeof seededCtor }],
        logMessage:
          "env-service.update.db.readExisting: ctx['update.dtoCtor'] missing/invalid.",
        logLevel: "error",
      });
      return;
    }

    const dtoCtor = seededCtor as unknown as UpdateDtoCtor;

    // Fail-fast: validate only handler-facing ctor surface (no indexHints).
    // DbReader enforces the index contract at the DB boundary (ADR-0106).
    if (typeof (dtoCtor as any)?.fromBody !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_invalid",
        detail:
          "Invalid ctx['update.dtoCtor']: expected a DTO ctor with static fromBody().",
        stage: "db.read.existingById:config.dtoCtor.fromBody",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.update.db.readExisting: ctx['update.dtoCtor'] missing static fromBody().",
        logLevel: "error",
      });
      return;
    }

    if (typeof (dtoCtor as any)?.dbCollectionName !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_invalid",
        detail:
          "Invalid ctx['update.dtoCtor']: expected a DTO ctor with static dbCollectionName().",
        stage: "db.read.existingById:config.dtoCtor.dbCollectionName",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage:
          "env-service.update.db.readExisting: ctx['update.dtoCtor'] missing static dbCollectionName().",
        logLevel: "error",
      });
      return;
    }

    const validateReads =
      this.safeCtxGet<boolean>("update.validateReads") ?? false;

    // DbReader gets mongo config + IndexGate via rt (ADR-0106).
    const reader = new DbReader<IDto>({
      rt: this.rt,
      dtoCtor,
      validateReads,
    });

    this.ctx.set("dbReader", reader);

    let existingBag: DtoBag<IDto>;
    try {
      existingBag = await reader.readOneBagById({ id });
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
