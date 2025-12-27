// backend/services/shared/src/http/handlers/handlerBaseExt/envHelpers.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0058 (HandlerBase.getVar — strict env accessor)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
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

/**
 * Guarded accessor used by HandlerBase.getVar().
 *
 * Behavior:
 * - Reads ONLY from controller.getRuntime().getVar()/tryVar().
 * - For DB-related keys (NV_MONGO_*):
 *     • throws ENV_DBVAR_USE_GETDBVAR to force callers over to getMongoConfig()
 */
export function getEnvVarFromRuntime(
  args: GetEnvVarFromRuntimeArgs
): string | undefined {
  const { controller, log, handlerName, key, required } = args;

  const rt = mustGetRuntime({ controller, log, handlerName, stage: "getVar" });

  // DB-related keys must NEVER flow through getVar() — they go through getMongoConfig()
  const dbKeys = new Set<string>([
    "NV_MONGO_URI",
    "NV_MONGO_DB",
    "NV_MONGO_COLLECTION",
    "NV_MONGO_COLLECTIONS",
    "NV_MONGO_USER",
    "NV_MONGO_PASS",
    "NV_MONGO_OPTIONS",
  ]);

  if (dbKeys.has(key)) {
    const msg =
      `ENV_DBVAR_USE_GETDBVAR: "${key}" is DB-related and must be accessed via getMongoConfig()/getDbVar(). ` +
      `Context: env="${rt.getEnv()}", service="${rt.getServiceSlug()}", version=${rt.getServiceVersion()}, dbState="${rt.getDbState()}". ` +
      "Ops: update callers to use getMongoConfig() so DB_STATE-aware naming and guardrails are enforced.";

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

  // Non-DB key: delegate to SvcRuntime vars
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

/**
 * Canonical Mongo config resolver for handlers.
 *
 * It is the implementation behind HandlerBase.getMongoConfig().
 *
 * Behavior:
 * - Reads BOTH NV_MONGO_URI and NV_MONGO_DB from SvcRuntime vars:
 *     • uri  = rt.getVar("NV_MONGO_URI")
 *     • base = rt.getVar("NV_MONGO_DB")
 * - Applies ADR-0074 DB_STATE semantics using SvcRuntime identity:
 *     • domain DBs: <NV_MONGO_DB>_<DB_STATE>
 *     • *_infra DBs: ignore DB_STATE
 *
 * This function NEVER calls getEnvVarFromRuntime() for DB vars, so it does not
 * trip the guardrail that protects HandlerBase.getVar().
 */
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
  let baseDbName: string;

  try {
    uri = rt.getVar("NV_MONGO_URI");
    baseDbName = rt.getVar("NV_MONGO_DB");
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    const msg =
      "Failed to resolve Mongo configuration via SvcRuntime vars. " +
      "Ops: verify NV_MONGO_URI and NV_MONGO_DB are present in env-service for this service (root/service merge).";
    log.error(
      {
        event: "mongo_config_runtime_vars_failed",
        handler: handlerName,
        error: errMsg,
      },
      msg
    );
    throw new Error(`${msg} Detail: ${errMsg}`);
  }

  const dbName = decorateDbNameWithDbState(baseDbName, rt.getDbState());

  if (!uri || !dbName) {
    const msg =
      "Mongo configuration incomplete: NV_MONGO_URI or NV_MONGO_DB is missing/empty after runtime resolution. " +
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
    "resolveMongoConfigWithDbState: resolved Mongo URI and DB name via SvcRuntime"
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

function decorateDbNameWithDbState(base: string, dbState: string): string {
  const b = (base ?? "").trim();
  if (!b) {
    throw new Error(
      'ENV_DBNAME_INVALID: NV_MONGO_DB is empty. Ops: set NV_MONGO_DB to a non-empty base name (e.g., "nv", "nv_env_infra").'
    );
  }

  const state = (dbState ?? "").trim();
  if (!state) {
    throw new Error(
      'ENV_DBSTATE_MISSING: DB_STATE is empty. Ops: set DB_STATE (e.g., "dev", "test", "stage") in the env-service config record(s).'
    );
  }

  if (b.toLowerCase().endsWith("_infra")) return b;

  return `${b}_${state}`;
}
