// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/loadExisting.update.handler.ts
/**
 * Docs:
 * - ADR-0040 (DTO-only persistence via Managers)
 * - ADR-0041/42/43/44
 * - ADR-0048 (Revised — bag-centric reads)
 *
 * Purpose:
 * - Build DbReader<XxxDto> and load existing doc by canonical ctx["id"].
 * - Returns a **DtoBag** (0..1) as ctx["existingBag"] (does NOT overwrite ctx["bag"]).
 *
 * Inputs (ctx):
 * - "id": string (required; controller sets from :id or :xxxId)
 * - "update.dtoCtor": DTO class (required)
 *
 * Outputs (ctx):
 * - "existingBag": DtoBag<XxxDto>  (size 0 or 1)
 * - "dbReader": DbReader<XxxDto>
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

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
        hint: "PATCH /api/xxx/v1/<id> with JSON body of fields to update.",
      });
      this.log.debug(
        { event: "execute_exit", reason: "missing_id" },
        "loadExisting.update exit"
      );
      return;
    }

    // --- Required dtoCtor ----------------------------------------------------
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

    // --- Env via HandlerBase.getVar (same as BagToDbCreateHandler) ----------
    // Prefer the centralized env wiring (svcenv/envBootstrap) over any ctx spelunking.
    const mongoUri = this.getVar("NV_MONGO_URI");
    const mongoDb = this.getVar("NV_MONGO_DB");

    // Optional: diagnose whether ControllerBase is actually holding svcEnv.
    const svcEnv = this.controller.getSvcEnv?.();
    const hasSvcEnv = !!svcEnv;

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in environment configuration. Ops: ensure env-service config is populated for this service.",
        hint: "Check env-service for NV_MONGO_URI/NV_MONGO_DB for this slug/env/version.",
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          handler: this.constructor.name,
          id,
        },
        "loadExisting.update aborted — Mongo env config missing"
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
