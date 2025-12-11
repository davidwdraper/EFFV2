// backend/services/user-auth/src/controllers/user-auth.update.controller/handlers/loadExisting.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 * - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *
 * Purpose:
 * - Build DbReader<UserAuthDto> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :userAuthId)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<UserAuthDto>  (size 0 or 1)
 * - "dbReader": DbReader<UserAuthDto>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class LoadExistingUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Ops-facing one-liner for logs and errors.
   */
  protected handlerPurpose(): string {
    return "user-auth.update.loadExisting: load existing record by id into ctx['existingBag']";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    this.log.debug(
      { event: "execute_enter", requestId },
      "loadExisting.update enter"
    );

    // --- Required id ---------------------------------------------------------
    const rawId = this.ctx.get("id");
    const id = String(rawId ?? "").trim();

    if (!id) {
      this.failWithError({
        httpStatus: 400,
        title: "missing_id",
        detail:
          "Path param :id is required for user-auth update. " +
          "Ops: verify the controller is seeding ctx['id'] from the URL path parameter.",
        stage: "loadExisting.update.id",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            path: "id",
            code: "required",
            message: "Path param :id is required.",
          },
        ],
        logMessage:
          "user-auth.update.loadExisting: ctx['id'] missing or empty; cannot read existing record.",
        logLevel: "warn",
      });
      return;
    }

    // --- Required dtoCtor ----------------------------------------------------
    const dtoCtor = this.ctx.get<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromJson !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "dto_ctor_missing",
        detail:
          "DTO constructor missing in ctx['update.dtoCtor'] or missing required static hydration method. " +
          "Ops: ensure the user-auth update pipeline seeds ctx['update.dtoCtor'] with the correct DTO class before LoadExistingUpdateHandler runs.",
        stage: "loadExisting.update.dtoCtor",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            path: "update.dtoCtor",
            code: "required",
            message:
              "DTO constructor with static fromJson()/fromBody() must be provided.",
          },
        ],
        logMessage:
          "user-auth.update.loadExisting: missing or invalid ctx['update.dtoCtor']; cannot construct DbReader.",
        logLevel: "error",
      });
      return;
    }

    // ---- Missing DB config throws via HandlerBase.getMongoConfig() ---------
    // Any failure here will:
    // - call failWithError(...) with a mongo_config_error
    // - throw, which HandlerBase.run() treats as already-handled
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;

    // --- Reader + fetch as **BAG** ------------------------------------------
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
        title: "db_read_failed",
        detail:
          "Database read failed while trying to load the existing user-auth record for update. " +
          "Ops: inspect logs for this requestId, verify Mongo connectivity, DB_STATE mapping, and user-auth collection indexes.",
        stage: "loadExisting.update.db.read",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        rawError: err,
        logMessage:
          "user-auth.update.loadExisting: DbReader.readOneBagById threw.",
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
          "No user-auth document found for the supplied :id. " +
          "Ops: confirm the id came from a prior create/read response and that DB_STATE is pointing at the expected database.",
        stage: "loadExisting.update.not_found",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            path: "id",
            code: "not_found",
            message: "No document found for supplied id.",
          },
        ],
        logMessage:
          "user-auth.update.loadExisting: no record found for id; returning 404.",
        logLevel: "warn",
      });
      return;
    }

    if (size > 1) {
      this.failWithError({
        httpStatus: 500,
        title: "multiple_matches",
        detail:
          "Invariant breach: multiple user-auth records matched a primary key lookup. " +
          "Ops: check unique index on _id and confirm there are no duplicate documents.",
        stage: "loadExisting.update.multiple_matches",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            path: "id",
            code: "duplicate_pk",
            message:
              "More than one record matched a supposedly unique primary key.",
          },
        ],
        logMessage:
          "user-auth.update.loadExisting: multiple records matched id; invariant violated.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      { event: "execute_exit", requestId, id },
      "loadExisting.update exit"
    );
  }
}
