// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/handlers/seed.mongoConfig.ts
/**
 * Docs:
 * - SOP: pipeline-specific seeders live in the pipeline; no shared “scenario logic”
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0074 (DB_STATE guardrail, `_infra` DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Seed ctx["db.mongo.*"] overrides so downstream shared DB LEGO handlers can
 *   read Mongo without relying on any ctx-held DbEnvServiceDto.
 *
 * Why this exists:
 * - env-service is special at boot: its runtime vars ultimately come from its
 *   own config, but reading that config requires Mongo access first.
 *
 * Contract (hard):
 * - ctx["rt"] ALWAYS (required)
 * - ctx["svcEnv"] NEVER (deleted)
 *
 * Inputs (ctx):
 * - "rt": SvcRuntime (required)
 *
 * Outputs (ctx):
 * - "db.mongo.uri": string
 * - "db.mongo.dbName": string   (MUST be state-invariant; ends with "_infra")
 * - "handlerStatus": "ok" | "error"
 *
 * Invariants:
 * - No IO. This only seeds ctx.
 * - No process.env reads.
 * - DB vars MUST be read via rt.getDbVar(...) (guardrail enforced).
 * - Hard-fail if the DB name is not "_infra" to avoid accidental DB_STATE decoration.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

export class SeedMongoConfigHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "code.seedMongoConfig";
  }

  protected handlerPurpose(): string {
    return "Seed ctx['db.mongo.*'] overrides from rt DB vars so DB handlers can run during env-service boot.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const rt = this.safeCtxGet<SvcRuntime>("rt");
    if (!rt) {
      this.failWithError({
        httpStatus: 500,
        title: "seed_mongo_config_rt_missing",
        detail:
          "SvcRuntime missing in ctx. Dev/Ops: ensure the controller seeds ctx['rt'] for this request (SvcRuntime is required by boot rails).",
        stage: "seed.mongoConfig:rt_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        logMessage: "seed.mongoConfig: ctx['rt'] missing.",
        logLevel: "error",
      });
      return;
    }

    let uri = "";
    let dbName = "";
    try {
      uri = rt.getDbVar("NV_MONGO_URI");
      dbName = rt.getDbVar("NV_MONGO_DB");
    } catch (err) {
      this.log.error(
        {
          event: "seed_mongo_config_dbvars_missing",
          requestId,
          rt: rt.describe(),
        },
        "seed.mongoConfig: rt.getDbVar() failed while seeding mongo override"
      );

      this.failWithError({
        httpStatus: 500,
        title: "seed_mongo_config_dbvars_missing",
        detail:
          "Unable to read NV_MONGO_URI/NV_MONGO_DB from rt.getDbVar() while seeding pipeline Mongo override. " +
          "Ops: ensure env-service runtime is constructed from a bootstrap DbEnvServiceDto that contains NV_MONGO_URI and NV_MONGO_DB for the config DB.",
        stage: "seed.mongoConfig:dbvars_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        rawError: err,
        issues: [
          { keys: ["NV_MONGO_URI", "NV_MONGO_DB"], accessor: "rt.getDbVar" },
        ],
        logMessage: "seed.mongoConfig: missing NV_MONGO_* DB vars in rt.",
        logLevel: "error",
      });
      return;
    }

    const uriTrim = (uri ?? "").trim();
    const dbTrim = (dbName ?? "").trim();

    if (!uriTrim || !dbTrim) {
      this.failWithError({
        httpStatus: 500,
        title: "seed_mongo_config_dbvars_empty",
        detail:
          "NV_MONGO_URI/NV_MONGO_DB are empty after reading from rt.getDbVar(). Ops: set both to non-empty strings in env-service bootstrap config.",
        stage: "seed.mongoConfig:dbvars_empty",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ uriPresent: !!uriTrim, dbPresent: !!dbTrim }],
        logMessage: "seed.mongoConfig: NV_MONGO_* DB vars empty in rt.",
        logLevel: "error",
      });
      return;
    }

    if (!dbTrim.toLowerCase().endsWith("_infra")) {
      this.failWithError({
        httpStatus: 500,
        title: "seed_mongo_config_db_not_infra",
        detail:
          `NV_MONGO_DB="${dbTrim}" must end with "_infra" for env-service config reads. ` +
          'Ops: point env-service at a state-invariant config DB (e.g., "nv_env_infra").',
        stage: "seed.mongoConfig:db_not_infra",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ dbName: dbTrim }],
        logMessage:
          "seed.mongoConfig: NV_MONGO_DB is not _infra; refusing override.",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set("db.mongo.uri", uriTrim);
    this.ctx.set("db.mongo.dbName", dbTrim);
    this.ctx.set("handlerStatus", "ok");
  }
}
