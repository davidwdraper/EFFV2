// backend/services/shared/src/http/handlers/db.readOne.byFilter.ts
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
 *
 * Notes:
 * - This is a **mid-pipeline** helper; it does not build wire payloads.
 * - Final handlers are responsible for ensuring ctx["bag"] is the canonical
 *   bag used by ControllerBase.finalize().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class DbReadOneByFilterHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Populate a DtoBag<TDto> from Mongo based on a filter and stash it on the ctx bus.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "bag.populate.query enter"
    );

    // ---- Config from ctx ----------------------------------------------------
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
      this.failWithError({
        httpStatus: 500,
        title: "bag_query_dto_ctor_missing",
        detail:
          "bag.query.dtoCtor missing or invalid. Dev: set ctx['bag.query.dtoCtor'] to the DTO class (with static fromBody/dbCollectionName).",
        stage: "config.dtoCtor",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            targetKey,
            hasDtoCtor: !!dtoCtor,
            hasFromBody: !!dtoCtor?.fromBody,
          },
        ],
        logMessage:
          "bag.populate.query — dtoCtor missing or invalid (bag.query.dtoCtor).",
        logLevel: "error",
      });
      return;
    }

    // ---- Env from ControllerBase (no ctx / no process.env) ----------------
    const svcEnv = (this.controller as any).getSvcEnv?.();
    if (!svcEnv) {
      this.failWithError({
        httpStatus: 500,
        title: "env_dto_missing",
        detail:
          "EnvServiceDto missing from ControllerJsonBase. Ops: ensure AppBase exposes svcEnv and controller extends ControllerJsonBase correctly.",
        stage: "config.svcEnv",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [],
        logMessage:
          "bag.populate.query — svcEnv missing from controller (EnvServiceDto).",
        logLevel: "error",
      });
      return;
    }

    const svcEnvAny: any = svcEnv;
    const envVars = svcEnvAny._vars as
      | Record<string, unknown>
      | undefined
      | null;

    if (!envVars || typeof envVars !== "object") {
      this.failWithError({
        httpStatus: 500,
        title: "env_vars_missing",
        detail:
          "EnvServiceDto._vars missing or invalid. Ops: ensure EnvServiceDto carries a concrete _vars map for this service.",
        stage: "config.envVars",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          service: svcEnvAny?.slug,
        },
        issues: [
          {
            hasVars: !!envVars,
            svcEnvSlug: svcEnvAny?.slug,
            svcEnvEnv: svcEnvAny?.env,
            svcEnvVersion: svcEnvAny?.version,
            hasVarsField: Object.prototype.hasOwnProperty.call(
              svcEnvAny,
              "_vars"
            ),
          },
        ],
        logMessage:
          "bag.populate.query — EnvServiceDto._vars missing or invalid.",
        logLevel: "error",
      });
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
      this.failWithError({
        httpStatus: 500,
        title: "mongo_env_missing",
        detail:
          "Missing NV_MONGO_URI or NV_MONGO_DB in EnvServiceDto._vars for this service. Ops: check env-service config for this slug/env/version.",
        stage: "config.mongoEnv",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
          service: svcEnvAny?.slug,
        },
        issues: [
          {
            mongoUriPresent: !!mongoUri,
            mongoDbPresent: !!mongoDb,
            svcEnvSlug: svcEnvAny?.slug,
            svcEnvEnv: svcEnvAny?.env,
            svcEnvVersion: svcEnvAny?.version,
            varsKeys: Object.keys(envVars),
          },
        ],
        logMessage:
          "bag.populate.query aborted — Mongo env config missing (NV_MONGO_URI / NV_MONGO_DB).",
        logLevel: "error",
      });
      return;
    }

    // ---- External edge: DB read (fine-grained try/catch) -------------------
    let bag: DtoBag<IDto>;
    try {
      const reader = new DbReader<any>({
        dtoCtor,
        mongoUri,
        mongoDb,
        validateReads,
      });

      this.ctx.set("dbReader", reader);

      bag = (await reader.readOneBag({
        filter,
      })) as DtoBag<IDto>;
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "bag_query_failed",
        detail:
          "DbReader.readOneBag() failed while populating a query-based DtoBag. Ops: check Mongo availability, filter shape, and DTO collection configuration.",
        stage: "db.readOneBag",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            targetKey,
            filter,
            validateReads,
          },
        ],
        rawError: err,
        logMessage:
          "bag.populate.query — DbReader.readOneBag failed while populating bag.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set(targetKey, bag);

    // ---- Business invariant: ensureSingleton (no extra try/catch needed) ---
    if (ensureSingleton) {
      const items = Array.from(bag.items());
      const size = items.length;

      if (size !== 1) {
        const status = size === 0 ? 404 : 500;

        this.failWithError({
          httpStatus: status,
          title:
            size === 0 ? "bag_query_not_found" : "bag_query_singleton_breach",
          detail:
            size === 0
              ? "No records matched the supplied filter."
              : `Invariant breach: expected exactly 1 record for the supplied filter; found ${size}.`,
          stage: "business.ensureSingleton",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              targetKey,
              filter,
              size,
            },
          ],
          logMessage:
            size === 0
              ? "bag.populate.query — no records matched filter (ensureSingleton)."
              : "bag.populate.query — singleton invariant breached (ensureSingleton).",
          logLevel: size === 0 ? "info" : "error",
        });
        return;
      }
    }

    // Success
    this.ctx.set("handlerStatus", "ok");
    this.log.debug(
      {
        event: "execute_exit",
        handler: this.constructor.name,
        targetKey,
        filterKeys: Object.keys(filter ?? {}),
        ensureSingleton,
        requestId,
      },
      "bag.populate.query exit"
    );
  }
}
