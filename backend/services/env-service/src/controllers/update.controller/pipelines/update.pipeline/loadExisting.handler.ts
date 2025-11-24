// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/loadExisting.handler.ts
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
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class LoadExistingUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "loadExisting.update enter");

    // --- Required id ---------------------------------------------------------
    const id = String(this.ctx.get("id") ?? "").trim();
    if (!id) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "MISSING_ID",
        title: "Bad Request",
        detail: "Path param :id is required.",
        hint: "PATCH /api/env-service/v1/:dtoType/update/:id with JSON body of fields to update.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "missing_id" },
        "loadExisting.update exit"
      );
      return;
    }

    // --- Required dtoCtor; svcEnv via controller (no ctx plumbing) ----------
    const dtoCtor = this.ctx.get<any>("update.dtoCtor");
    if (!dtoCtor || typeof dtoCtor.fromJson !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "DTO_CTOR_MISSING",
        title: "Internal Error",
        detail:
          "DTO constructor missing in ctx as 'update.dtoCtor' or missing static fromJson().",
      });
      this.log.debug(
        { event: "execute_exit", reason: "dtoCtor_missing" },
        "loadExisting.update exit"
      );
      return;
    }

    // svcEnv is the effective env object exposed by the app/controller
    const svcEnv = this.controller.getSvcEnv?.();
    if (!svcEnv || typeof svcEnv.getEnvVar !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SERVICE_ENV_UNAVAILABLE",
        title: "Internal Error",
        detail:
          "Service environment configuration is unavailable. Ops: ensure AppBase/ControllerBase seeds svcEnv with NV_MONGO_URI/NV_MONGO_DB.",
      });
      this.log.error(
        { event: "svc_env_unavailable" },
        "LoadExistingUpdateHandler: svcEnv unavailable or invalid"
      );
      return;
    }

    let mongoUri: string;
    let mongoDb: string;
    try {
      mongoUri = svcEnv.getEnvVar("NV_MONGO_URI");
      mongoDb = svcEnv.getEnvVar("NV_MONGO_DB");
    } catch (err) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "SERVICE_DB_CONFIG_MISSING",
        title: "Internal Error",
        detail:
          (err as Error)?.message ??
          "Missing NV_MONGO_URI/NV_MONGO_DB in env-service configuration. Ops: ensure these keys exist and are valid.",
      });

      this.log.error(
        {
          event: "service_db_config_missing",
          err:
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : err,
        },
        "LoadExistingUpdateHandler: failed to resolve DB config from svcEnv"
      );
      return;
    }

    // --- Reader + fetch as **BAG** ------------------------------------------
    const validateReads =
      this.ctx.get<boolean>("update.validateReads") ?? false;

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
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 404);
      this.ctx.set("error", {
        code: "NOT_FOUND",
        title: "Not Found",
        detail: "No document found for supplied :id.",
        hint: "Confirm the id from create/read response; ensure same collection.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "not_found", id },
        "loadExisting.update exit"
      );
      return;
    }
    if (size > 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MULTIPLE_MATCHES",
        title: "Internal Error",
        detail:
          "Invariant breach: multiple records matched primary key lookup.",
        hint: "Check unique index on _id and upstream normalization.",
      });
      this.log.warn(
        { event: "pk_multiple_matches", id, count: size },
        "expected singleton bag for id read"
      );
      return;
    }

    this.ctx.set("handlerStatus", "ok");
    this.log.debug({ event: "execute_exit", id }, "loadExisting.update exit");
  }
}
