// backend/services/shared/src/http/handlers/handlerBaseExt/envHelpers.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0058 (HandlerBase.getVar — strict env accessor)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar(), and `_infra` DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Shared helpers used by HandlerBase for:
 *   • Strict, logged access to runtime vars (getEnvVarFromRuntime).
 *   • DB_STATE-aware Mongo config resolution (resolveMongoConfigWithDbState).
 *
 * Invariants:
 * - HandlerBase.getVar() MUST go through getEnvVarFromRuntime().
 * - DB-related keys (NV_MONGO_*) are **forbidden** via getVar() and must be
 *   accessed via getMongoConfig() → resolveMongoConfigWithDbState().
 * - No svcEnv reads here. SvcRuntime is the canonical runtime owner (ADR-0080).
 */

import type { ControllerBase } from "../../../base/controller/ControllerBase";
import type { IBoundLogger } from "../../../logger/Logger";
import type { SvcRuntime } from "../../../runtime/SvcRuntime";

type GetEnvVarFromRuntimeArgs = {
  controller: ControllerBase;
  log: IBoundLogger;
  handlerName: string;
  key: string;
  required: boolean;
};

const DB_KEYS = new Set<string>([
  "NV_MONGO_URI",
  "NV_MONGO_DB",
  "NV_MONGO_COLLECTION",
  "NV_MONGO_COLLECTIONS",
  "NV_MONGO_USER",
  "NV_MONGO_PASS",
  "NV_MONGO_OPTIONS",
]);

export function getEnvVarFromRuntime(
  args: GetEnvVarFromRuntimeArgs
): string | undefined {
  const { controller, log, handlerName, key, required } = args;

  const rt = mustGetRuntime({ controller, log, handlerName, stage: "getVar" });

  if (DB_KEYS.has(key)) {
    const msg =
      `ENV_DBVAR_USE_GETDBVAR: "${key}" is DB-related and must be accessed via getMongoConfig()/rt.getDbVar("${key}"). ` +
      `Context: env="${rt.getEnv()}", service="${rt.getServiceSlug()}", version=${rt.getServiceVersion()}, dbState="${rt.getDbState()}". ` +
      "Dev: for handlers, call getMongoConfig(); for boot/db wiring, call rt.getDbVar().";

    log.error(
      {
        event: "getVar_db_key_forbidden",
        handler: handlerName,
        key,
        env: rt.getEnv(),
        service: rt.getServiceSlug(),
        version: rt.getServiceVersion(),
        dbState: rt.getDbState(),
      },
      msg
    );

    throw new Error(msg);
  }

  try {
    const value = required ? rt.getVar(key) : rt.tryVar(key);

    if (!value && required) {
      log.error(
        {
          event: "getVar_required_empty",
          handler: handlerName,
          key,
        },
        `Required runtime var '${key}' is empty.`
      );
      throw new Error(
        `[EnvVarMissing] Required runtime var '${key}' is empty or missing.`
      );
    }

    return value || undefined;
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    log.error(
      {
        event: "getVar_runtime_threw",
        handler: handlerName,
        key,
        required,
        error: errMsg,
      },
      `getVar('${key}', ${required}) — runtime var access threw`
    );

    if (required) {
      throw new Error(
        `[EnvVarMissing] Required runtime var '${key}' could not be read (runtime threw).`
      );
    }

    return undefined;
  }
}

type ResolveMongoConfigArgs = {
  controller: ControllerBase;
  log: IBoundLogger;
  handlerName: string;
};

export function resolveMongoConfigWithDbState(args: ResolveMongoConfigArgs): {
  uri: string;
  dbName: string;
} {
  const { controller, log, handlerName } = args;

  const rt = mustGetRuntime({
    controller,
    log,
    handlerName,
    stage: "getMongoConfig",
  });

  let uri: string;
  let dbName: string;

  try {
    // ADR-0074: DB vars must be read via getDbVar()
    uri = rt.getDbVar("NV_MONGO_URI");
    dbName = rt.getDbVar("NV_MONGO_DB"); // already DB_STATE-decorated by runtime
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    const msg =
      "Failed to resolve Mongo configuration via SvcRuntime DB vars. " +
      "Ops: verify NV_MONGO_URI and NV_MONGO_DB are present in env-service for this service (root/service merge).";
    log.error(
      {
        event: "mongo_config_runtime_dbvars_failed",
        handler: handlerName,
        error: errMsg,
      },
      msg
    );
    throw new Error(`${msg} Detail: ${errMsg}`);
  }

  if (!uri || !dbName) {
    const msg =
      "Mongo configuration incomplete: NV_MONGO_URI or NV_MONGO_DB is missing/empty after runtime DB var resolution. " +
      "Ops: fix the env-service document(s) for this service/version.";
    log.error(
      {
        event: "mongo_config_missing_values",
        handler: handlerName,
        uri_present: !!uri,
        db_present: !!dbName,
      },
      msg
    );
    throw new Error(msg);
  }

  log.debug(
    {
      event: "mongo_config_resolved",
      handler: handlerName,
      dbName,
      dbState: rt.getDbState(),
    },
    "resolveMongoConfigWithDbState: resolved Mongo URI and DB name via SvcRuntime DB vars"
  );

  return { uri, dbName };
}

// ───────────────────────────────────────────
// Internals
// ───────────────────────────────────────────

function mustGetRuntime(args: {
  controller: ControllerBase;
  log: IBoundLogger;
  handlerName: string;
  stage: string;
}): SvcRuntime {
  const { controller, log, handlerName, stage } = args;

  try {
    return controller.getRuntime();
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    const msg =
      "SvcRuntime is required but unavailable. " +
      "Ops/Dev: wire SvcRuntime at service boot and ensure ControllerBase seeds ctx['rt'].";
    log.error(
      {
        event: "rt_missing",
        handler: handlerName,
        stage,
        error: errMsg,
      },
      msg
    );
    throw new Error(`${msg} Detail: ${errMsg}`);
  }
}
