// backend/services/shared/src/http/handlers/bag.populate.query.handler.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; bag-centric reads
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047/0048 (All reads return DtoBag)
 *   - ADR-0050 (Wire Bag Envelope)
 *
 * Purpose:
 * - Populate a DtoBag<TDto> from Mongo based on a filter, and stash it on the ctx bus.
 * - Generic, reusable handler — analogous to bag.populate.get.handler, but for DB queries.
 *
 * Config (from ctx):
 * - "bag.query.dtoCtor":         DTO class (required; must have fromBody + dbCollectionName)
 * - "bag.query.filter":         Record<string, unknown> (required)
 * - "bag.query.targetKey":      string ctx key to write the bag to (default: "bag")
 * - "bag.query.validateReads":  boolean (default: false)
 * - "bag.query.ensureSingleton":boolean (default: false)
 *
 * Outputs (ctx):
 * - [targetKey]: DtoBag<TDto>
 * - "dbReader":  DbReader<TDto> (for logging/introspection if desired)
 * - "handlerStatus": "ok" | "error"
 * - "response.status" / "response.body" on error
 *
 * Notes:
 * - This is a **mid-pipeline** helper; it does not build wire payloads.
 * - Final handlers are responsible for ensuring ctx["bag"] is the canonical
 *   bag used by ControllerBase.finalize().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class BagPopulateQueryHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    this.log.debug({ event: "execute_enter" }, "bag.populate.query enter");

    const requestId =
      (this.ctx.get<string>("requestId") as string | undefined) ?? "unknown";

    const dtoCtor = this.ctx.get<any>("bag.query.dtoCtor");
    const filter =
      (this.ctx.get<Record<string, unknown>>("bag.query.filter") as
        | Record<string, unknown>
        | undefined) ?? {};
    const targetKey =
      (this.ctx.get<string>("bag.query.targetKey") as string | undefined) ??
      "bag";
    const validateReads =
      this.ctx.get<boolean>("bag.query.validateReads") ?? false;
    const ensureSingleton =
      this.ctx.get<boolean>("bag.query.ensureSingleton") ?? false;

    if (!dtoCtor || typeof dtoCtor.fromBody !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "BAG_QUERY_DTO_CTOR_MISSING",
        title: "Internal Error",
        detail:
          "bag.query.dtoCtor missing or invalid. Dev: set ctx['bag.query.dtoCtor'] to the DTO class (with static fromBody/dbCollectionName).",
        requestId,
      });
      this.log.debug(
        {
          event: "execute_exit",
          reason: "dtoCtor_missing",
          targetKey,
          requestId,
        },
        "bag.populate.query exit"
      );
      return;
    }

    // ---- Env from ControllerBase (no ctx / no process.env) ----------------
    const svcEnv = (this.controller as any).getSvcEnv?.();
    if (!svcEnv) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_DTO_MISSING",
        title: "Internal Error",
        detail:
          "EnvServiceDto missing from ControllerBase. Ops: ensure AppBase exposes svcEnv and controller extends ControllerBase correctly.",
        requestId,
      });
      this.log.error(
        { event: "env_missing", requestId },
        "bag.populate.query — svcEnv missing"
      );
      return;
    }

    const svcEnvAny: any = svcEnv;

    // Explicit interface: EnvServiceDto stores vars in `_vars`.
    const envVars = svcEnvAny._vars as
      | Record<string, unknown>
      | undefined
      | null;

    if (!envVars || typeof envVars !== "object") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "ENV_VARS_MISSING",
        title: "Internal Error",
        detail:
          "EnvServiceDto._vars missing or invalid. Ops: ensure EnvServiceDto carries a concrete _vars map for this service.",
        requestId,
      });
      this.log.error(
        {
          event: "env_vars_missing",
          svcEnvSlug: svcEnvAny?.slug,
          svcEnvEnv: svcEnvAny?.env,
          svcEnvVersion: svcEnvAny?.version,
          hasVarsField: Object.prototype.hasOwnProperty.call(
            svcEnvAny,
            "_vars"
          ),
          requestId,
        },
        "bag.populate.query — EnvServiceDto._vars missing/invalid"
      );
      return;
    }

    // Snapshot for debugging
    this.log.debug(
      {
        event: "svcEnv_inspect",
        svcEnvType: svcEnvAny?.type,
        svcEnvSlug: svcEnvAny?.slug,
        svcEnvEnv: svcEnvAny?.env,
        svcEnvVersion: svcEnvAny?.version,
        varsKeys: Object.keys(envVars),
        requestId,
      },
      "bag.populate.query — svcEnv snapshot"
    );

    const mongoUri = envVars["NV_MONGO_URI"] as string | undefined;
    const mongoDb = envVars["NV_MONGO_DB"] as string | undefined;

    if (!mongoUri || !mongoDb) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "MONGO_ENV_MISSING",
        title: "Internal Error",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in EnvServiceDto._vars for this service.",
        hint: "Check env-service config for this slug/env/version and ensure NV_MONGO_URI and NV_MONGO_DB are present under vars.",
        requestId,
      });
      this.log.error(
        {
          event: "mongo_env_missing",
          hasSvcEnv: !!svcEnv,
          mongoUriPresent: !!mongoUri,
          mongoDbPresent: !!mongoDb,
          svcEnvSlug: svcEnvAny?.slug,
          svcEnvEnv: svcEnvAny?.env,
          svcEnvVersion: svcEnvAny?.version,
          varsKeys: Object.keys(envVars),
          requestId,
        },
        "bag.populate.query aborted — Mongo env config missing"
      );
      return;
    }

    try {
      const reader = new DbReader<any>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads,
      });
      this.ctx.set("dbReader", reader);

      const bag = (await reader.readOneBag({
        filter,
      })) as DtoBag<IDto>;

      this.ctx.set(targetKey, bag);

      if (ensureSingleton) {
        const items = Array.from(bag.items());
        const size = items.length;

        if (size !== 1) {
          const status = size === 0 ? 404 : 500;
          this.ctx.set("handlerStatus", "error");
          this.ctx.set("response.status", status);
          this.ctx.set("response.body", {
            code:
              size === 0 ? "BAG_QUERY_NOT_FOUND" : "BAG_QUERY_SINGLETON_BREACH",
            title: size === 0 ? "Not Found" : "Internal Error",
            detail:
              size === 0
                ? "No records matched the supplied filter."
                : `Invariant breach: expected exactly 1 record for supplied filter; found ${size}.`,
            requestId,
            context: { targetKey, filter },
          });
          this.log.warn(
            {
              event: "singleton_breach",
              targetKey,
              size,
              filter,
              requestId,
            },
            "bag.populate.query — ensureSingleton failed"
          );
          return;
        }
      }

      this.ctx.set("handlerStatus", "ok");
      this.log.debug(
        {
          event: "execute_exit",
          targetKey,
          filterKeys: Object.keys(filter ?? {}),
          requestId,
        },
        "bag.populate.query exit"
      );
    } catch (err: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "BAG_QUERY_FAILED",
        title: "Internal Error",
        detail: err?.message ?? String(err),
        requestId,
        context: { targetKey, filter },
      });
      this.log.error(
        {
          event: "bag_query_failed",
          err: err?.message,
          targetKey,
          filter,
          requestId,
        },
        "bag.populate.query — DbReader.readOneBag failed"
      );
    }
  }
}
