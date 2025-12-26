// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/handlers/seed.mongoConfig.ts
/**
 * Docs:
 * - SOP: pipeline-specific seeders live in the pipeline; no shared “scenario logic”
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0074 (DB_STATE guardrail, `_infra` DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Seed ctx["db.mongo.*"] overrides so downstream shared DB LEGO handlers can
 *   read Mongo *without* relying on SvcRuntime vars being populated yet.
 *
 * Why this exists:
 * - env-service is special at boot: its runtime vars ultimately come from its
 *   own config, but reading that config requires Mongo access first.
 *
 * Inputs (ctx):
 * - "svcEnv": EnvServiceDto (required; seeded by ControllerBase.makeContext)
 *
 * Outputs (ctx):
 * - "db.mongo.uri": string
 * - "db.mongo.dbName": string   (MUST be state-invariant; ends with "_infra")
 * - "handlerStatus": "ok" | "error"
 *
 * Invariants:
 * - No IO. This only seeds ctx.
 * - No process.env reads. Use the seeded svcEnv DTO.
 * - DB vars MUST be read via svcEnv.getDbVar(...) (guardrail enforced).
 * - Hard-fail if the DB name is not "_infra" to avoid accidental DB_STATE decoration.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

export class SeedMongoConfigHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "seed.mongoConfig";
  }

  protected handlerPurpose(): string {
    return "Seed ctx['db.mongo.*'] overrides from svcEnv so DB handlers can run before runtime vars are available.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const svcEnv = this.safeCtxGet<EnvServiceDto>("svcEnv");
    if (!svcEnv) {
      this.failWithError({
        httpStatus: 500,
        title: "seed_mongo_config_svcenv_missing",
        detail:
          "svcEnv missing in ctx. Dev/Ops: ControllerBase.makeContext must seed ctx['svcEnv'] for env-service.",
        stage: "seed.mongoConfig:svcEnv_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        logMessage: "seed.mongoConfig: ctx['svcEnv'] missing.",
        logLevel: "error",
      });
      return;
    }

    // DB vars MUST come through getDbVar() (guardrail).
    let uri = "";
    let dbName = "";
    try {
      const anyEnv = svcEnv as any;

      if (typeof anyEnv.getDbVar !== "function") {
        throw new Error(
          "EnvServiceDto.getDbVar is missing. Dev: EnvServiceDto must expose getDbVar(key) for NV_MONGO_* keys."
        );
      }

      uri = anyEnv.getDbVar("NV_MONGO_URI");
      dbName = anyEnv.getDbVar("NV_MONGO_DB");
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "seed_mongo_config_dbvars_missing",
        detail:
          "Unable to read NV_MONGO_URI/NV_MONGO_DB from svcEnv via getDbVar() while seeding pipeline Mongo override. " +
          "Ops: ensure env-service root/service merge produces these DB vars for env-service.",
        stage: "seed.mongoConfig:dbvars_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        rawError: err,
        issues: [
          { keys: ["NV_MONGO_URI", "NV_MONGO_DB"], accessor: "getDbVar" },
        ],
        logMessage: "seed.mongoConfig: missing NV_MONGO_* DB vars in svcEnv.",
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
          "NV_MONGO_URI/NV_MONGO_DB are empty after reading from svcEnv.getDbVar(). Ops: set both to non-empty strings in env-service config.",
        stage: "seed.mongoConfig:dbvars_empty",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ uriPresent: !!uriTrim, dbPresent: !!dbTrim }],
        logMessage: "seed.mongoConfig: NV_MONGO_* DB vars empty in svcEnv.",
        logLevel: "error",
      });
      return;
    }

    // Guardrail: env-service config DB must be infra (state-invariant).
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

    // Seed the override pair used by downstream DB LEGO(s).
    this.ctx.set("db.mongo.uri", uriTrim);
    this.ctx.set("db.mongo.dbName", dbTrim);

    this.ctx.set("handlerStatus", "ok");
  }
}
