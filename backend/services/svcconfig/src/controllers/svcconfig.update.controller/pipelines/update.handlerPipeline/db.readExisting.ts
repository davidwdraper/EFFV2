// backend/services/svcconfig/src/controllers/svcconfig.update.controller/pipelines/update.handlerPipeline/db.readExisting.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 * - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcSandbox Refactored (ADR-0080)
 *
 * Purpose:
 * - Build DbReader<SvcconfigDto> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :svcconfigId)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<SvcconfigDto>  (size 0 or 1)
 * - "dbReader": DbReader<SvcconfigDto>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class DbReadExistingHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * Handler naming convention:
   * - db.<dbName>.<collectionName>.<op>
   *
   * For svcconfig update-by-id:
   * - DB: nv
   * - Collection: svcconfig
   * - Op: read-one-by-id
   */
  public handlerName(): string {
    return "db.nv.svcconfig.read-one-by-id";
  }

  protected handlerPurpose(): string {
    return "Read existing svcconfig document by canonical id into ctx['existingBag'] without touching ctx['bag'].";
  }

  protected async execute(): Promise<void> {
    const requestId = this.getRequestId();

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.handlerName(),
        requestId,
      },
      "DbReadExistingHandler.execute loadExisting.update enter"
    );

    // --- Required id ---------------------------------------------------------
    const idRaw = this.safeCtxGet<unknown>("id");
    const id =
      typeof idRaw === "string" ? idRaw.trim() : String(idRaw ?? "").trim();

    if (!id) {
      const error = this.failWithError({
        httpStatus: 400,
        title: "bad_request",
        detail:
          "Path param :id is required for svcconfig update. Dev: ensure controller maps :id/:svcconfigId into ctx['id'] before this handler.",
        stage: "svcconfig.update.readExisting.id",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            key: "id",
            message: "Missing or empty id for update-by-id.",
          },
        ],
        logMessage:
          "DbReadExistingHandler.execute missing id in context for svcconfig update",
        logLevel: "warn",
      });

      this.ctx.set("response.status", error.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "Bad Request",
        detail: "Path param :id is required.",
        status: error.httpStatus,
        code: "MISSING_ID",
        hint: "PATCH /api/svcconfig/v1/<id> with JSON body of fields to update.",
        requestId,
      });
      return;
    }

    // --- Required dtoCtor ----------------------------------------------------
    const dtoCtor = this.safeCtxGet<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      const error = this.failWithError({
        httpStatus: 500,
        title: "internal_error",
        detail:
          "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromBody(). Dev: ensure update pipeline seeds 'update.dtoCtor' correctly.",
        stage: "svcconfig.update.readExisting.dtoCtor",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            key: "update.dtoCtor",
            hasDtoCtor: !!dtoCtor,
            hasFromBody: !!dtoCtor?.fromBody,
          },
        ],
        logMessage:
          "DbReadExistingHandler.execute missing or invalid update.dtoCtor for svcconfig update",
        logLevel: "error",
      });

      this.ctx.set("response.status", error.httpStatus);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "Internal Error",
        detail:
          "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromBody().",
        status: error.httpStatus,
        code: "DTO_CTOR_MISSING",
        requestId,
      });
      return;
    }

    // ---- Missing DB config throws ------------------------
    const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

    // Optional: diagnose whether ControllerBase is actually holding svcEnv.
    const svcEnv = (this.controller as any).getSvcEnv?.();
    const hasSvcEnv = !!svcEnv;

    // --- Reader + fetch as **BAG** ------------------------------------------
    const validateReads =
      this.safeCtxGet<boolean>("update.validateReads") ?? false;

    try {
      const reader = new DbReader<any>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads,
      });
      this.ctx.set("dbReader", reader);

      const existingBag = await reader.readOneBagById({ id });
      this.ctx.set("existingBag", existingBag as DtoBag<IDto>);

      const size = Array.from(existingBag.items()).length;

      if (size === 0) {
        const error = this.failWithError({
          httpStatus: 404,
          title: "not_found",
          detail:
            "No svcconfig document found for the supplied id. Ops: confirm id and collection.",
          stage: "svcconfig.update.readExisting.notFound",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              id,
              message: "No document returned from readOneBagById.",
            },
          ],
          logMessage:
            "DbReadExistingHandler.execute no svcconfig document found for id",
          logLevel: "warn",
        });

        this.ctx.set("response.status", error.httpStatus);
        this.ctx.set("response.body", {
          type: "about:blank",
          title: "Not Found",
          detail: "No document found for supplied :id.",
          status: error.httpStatus,
          code: "NOT_FOUND",
          hint: "Confirm the id from create/read response; ensure same collection.",
          requestId,
        });

        this.log.debug(
          {
            event: "execute_exit",
            reason: "not_found",
            id,
            requestId,
          },
          "DbReadExistingHandler.execute loadExisting.update exit (not found)"
        );
        return;
      }

      if (size > 1) {
        const error = this.failWithError({
          httpStatus: 500,
          title: "internal_error",
          detail:
            "Invariant breach: multiple records matched primary key lookup for svcconfig.",
          stage: "svcconfig.update.readExisting.multiple",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              id,
              count: size,
              message:
                "Expected a singleton bag from readOneBagById but received multiple items.",
            },
          ],
          logMessage:
            "DbReadExistingHandler.execute multiple svcconfig records matched primary key lookup",
          logLevel: "error",
        });

        this.ctx.set("response.status", error.httpStatus);
        this.ctx.set("response.body", {
          type: "about:blank",
          title: "Internal Error",
          detail:
            "Invariant breach: multiple records matched primary key lookup.",
          status: error.httpStatus,
          code: "MULTIPLE_MATCHES",
          hint: "Check unique index on _id and upstream normalization.",
          requestId,
        });

        this.log.warn(
          {
            event: "pk_multiple_matches",
            id,
            count: size,
            requestId,
          },
          "DbReadExistingHandler.execute expected singleton bag for id read"
        );
        return;
      }

      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "execute_exit",
          handler: this.handlerName(),
          id,
          size,
          requestId,
        },
        "DbReadExistingHandler.execute loadExisting.update exit (success)"
      );
    } catch (rawError: any) {
      const error = this.failWithError({
        httpStatus: 500,
        title: "db_read_failed",
        detail:
          "Database read for existing svcconfig document failed unexpectedly. Ops: inspect logs for handler and requestId.",
        stage: "svcconfig.update.readExisting.read",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            id,
            hint: "Check Mongo connectivity, collection indexes, and DbReader configuration.",
          },
        ],
        rawError,
        logMessage:
          "DbReadExistingHandler.execute unhandled exception during svcconfig readOneBagById()",
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
