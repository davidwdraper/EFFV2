// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/db.readExisting.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 *
 * Purpose:
 * - Build DbReader<EnvServiceDto> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :envServiceId)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<EnvServiceDto>  (size 0 or 1)
 * - "dbReader": DbReader<EnvServiceDto>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class DbReadExistingHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Use DbReader<EnvServiceDto> to load an existing record by ctx['id'] into ctx['existingBag'] without touching ctx['bag'].";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      { event: "update_existing_enter", requestId },
      "env-service.update.db.readExisting: enter"
    );

    try {
      // --- Required id -------------------------------------------------------
      const idRaw = this.ctx.get("id");
      const id = typeof idRaw === "string" ? idRaw.trim() : "";

      if (!id) {
        this.failWithError({
          httpStatus: 400,
          title: "missing_id",
          detail:
            "Path param ':id' is required. Example: PATCH /api/env-service/v1/:dtoType/update/:id with JSON body of fields to update.",
          stage: "update.readExisting.id.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.readExisting: ctx['id'] missing or empty.",
          logLevel: "warn",
        });
        this.log.debug(
          { event: "update_existing_exit", reason: "missing_id", requestId },
          "env-service.update.db.readExisting: exit (missing id)"
        );
        return;
      }

      // --- Required dtoCtor; svcEnv via controller (no ctx plumbing) --------
      const dtoCtor = this.ctx.get<any>("update.dtoCtor");
      if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
        this.failWithError({
          httpStatus: 500,
          title: "dto_ctor_missing",
          detail:
            "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromBody().",
          stage: "update.readExisting.dtoCtor.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.readExisting: ctx['update.dtoCtor'] missing or invalid.",
          logLevel: "error",
        });
        this.log.debug(
          {
            event: "update_existing_exit",
            reason: "dtoCtor_missing",
            requestId,
          },
          "env-service.update.db.readExisting: exit (dtoCtor missing)"
        );
        return;
      }

      // svcEnv is the effective env object exposed by the app/controller
      const svcEnv = this.controller.getSvcEnv?.();
      if (!svcEnv || typeof svcEnv.getEnvVar !== "function") {
        this.failWithError({
          httpStatus: 500,
          title: "service_env_unavailable",
          detail:
            "Service environment configuration is unavailable. Ops: ensure AppBase/ControllerBase seeds svcEnv with NV_MONGO_URI/NV_MONGO_DB.",
          stage: "update.readExisting.svcEnv.missing",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.readExisting: svcEnv unavailable or invalid.",
          logLevel: "error",
        });
        this.log.error(
          { event: "svc_env_unavailable", requestId },
          "env-service.update.db.readExisting: svcEnv unavailable or invalid"
        );
        return;
      }

      // ---- Missing DB config throws ------------------------
      const { uri: mongoUri, dbName: mongoDb } = this.getMongoConfig();

      // --- Reader + fetch as **BAG** ----------------------------------------
      const validateReads =
        this.ctx.get<boolean>("update.validateReads") ?? false;

      let reader: DbReader<any>;
      try {
        reader = new DbReader<any>({
          dtoCtor,
          mongoUri,
          mongoDb,
          validateReads,
        });
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "db_reader_init_failed",
          detail:
            (err as Error)?.message ??
            "Failed to construct DbReader for env-service update read-by-id. Ops: verify Mongo URI/DB and DTO wiring.",
          stage: "update.readExisting.dbReader.init",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.readExisting: DbReader construction failed.",
          logLevel: "error",
        });
        return;
      }

      this.ctx.set("dbReader", reader);

      let existingBag: DtoBag<IDto>;
      try {
        existingBag = (await reader.readOneBagById({
          id,
        })) as DtoBag<IDto>;
      } catch (err) {
        this.failWithError({
          httpStatus: 500,
          title: "db_read_by_id_failed",
          detail:
            (err as Error)?.message ??
            "Database read failed while fetching existing document by id.",
          stage: "update.readExisting.readOneBagById",
          requestId,
          rawError: err,
          origin: {
            file: __filename,
            method: "execute",
          },
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
          stage: "update.readExisting.not_found",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.readExisting: no document found for supplied id.",
          logLevel: "warn",
        });

        this.log.debug(
          {
            event: "update_existing_exit",
            reason: "not_found",
            id,
            requestId,
          },
          "env-service.update.db.readExisting: exit (not found)"
        );
        return;
      }

      if (size > 1) {
        this.failWithError({
          httpStatus: 500,
          title: "multiple_matches",
          detail:
            "Invariant breach: multiple records matched primary key lookup. Ops: check unique index on _id and upstream normalization.",
          stage: "update.readExisting.multiple_matches",
          requestId,
          rawError: null,
          origin: {
            file: __filename,
            method: "execute",
          },
          logMessage:
            "env-service.update.db.readExisting: multiple records matched primary key lookup.",
          logLevel: "error",
        });

        this.log.warn(
          { event: "pk_multiple_matches", id, count: size, requestId },
          "env-service.update.db.readExisting: expected singleton bag for id read"
        );
        return;
      }

      this.ctx.set("handlerStatus", "ok");
      this.log.debug(
        { event: "update_existing_exit", id, requestId },
        "env-service.update.db.readExisting: exit (ok)"
      );
    } catch (err) {
      // Unexpected handler bug, catch-all
      this.failWithError({
        httpStatus: 500,
        title: "update_read_existing_handler_failure",
        detail:
          "Unhandled exception while loading existing document for update. Ops: inspect logs for requestId and stack frame.",
        stage: "update.readExisting.execute.unhandled",
        requestId,
        rawError: err,
        origin: {
          file: __filename,
          method: "execute",
        },
        logMessage:
          "env-service.update.db.readExisting: unhandled exception in handler execute().",
        logLevel: "error",
      });
    }
  }
}
