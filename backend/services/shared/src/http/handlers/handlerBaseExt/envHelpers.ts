// backend/services/shared/src/http/handlers/handlerBaseExt/envHelpers.ts
/**
 * Docs:
 * - ADR-0058 (HandlerBase.getVar — strict svcEnv accessor)
 * - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *
 * Purpose:
 * - Shared helpers used by HandlerBase for:
 *   • Strict, logged access to svcEnv variables (getEnvVarFromSvcEnv).
 *   • DB_STATE-aware Mongo config resolution (resolveMongoConfigWithDbState).
 *
 * Invariants:
 * - HandlerBase.getVar() MUST go through getEnvVarFromSvcEnv().
 * - DB-related keys (NV_MONGO_*) are **forbidden** via getVar() and must be
 *   accessed via getMongoConfig() → resolveMongoConfigWithDbState() →
 *   svcEnv.getDbVar().
 */

import type { ControllerBase } from "../../../base/controller/ControllerBase";
import type { IBoundLogger } from "../../../logger/Logger";

type GetEnvVarFromSvcEnvArgs = {
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
 * - Reads ONLY from controller.getSvcEnv().
 * - For non-DB keys:
 *     • calls svcEnv.getEnvVar(name)
 *     • logs failures with first-order context
 * - For DB-related keys (NV_MONGO_*, DB_STATE, etc.):
 *     • throws ENV_DBVAR_USE_GETDBVAR to force callers over to getMongoConfig()
 */
export function getEnvVarFromSvcEnv(
  args: GetEnvVarFromSvcEnvArgs
): string | undefined {
  const { controller, log, handlerName, key, required } = args;

  const svcEnv: any = controller.getSvcEnv?.();
  if (!svcEnv) {
    const msg =
      "Service environment configuration is unavailable. " +
      "Ops: ensure AppBase/ControllerBase seeds svcEnv from envBootstrap/env-service.";
    log.error(
      {
        event: "getVar_svcEnv_missing",
        handler: handlerName,
        key,
      },
      msg
    );
    if (required) {
      throw new Error(
        `[EnvVarMissing] Required svc env var '${key}' could not be read (svcEnv missing).`
      );
    }
    return undefined;
  }

  const hasGetEnvVar = typeof svcEnv.getEnvVar === "function";
  if (!hasGetEnvVar) {
    const msg =
      "svcEnv.getEnvVar is not implemented on this env DTO. " +
      "Ops: ensure EnvServiceDto (or equivalent) exposes getEnvVar(name: string).";
    log.error(
      {
        event: "getVar_getter_missing",
        handler: handlerName,
        key,
      },
      msg
    );
    if (required) {
      throw new Error(
        `[EnvVarMissing] Required svc env var '${key}' could not be read (getter missing).`
      );
    }
    return undefined;
  }

  // DB-related keys must NEVER flow through getVar() — they go through getDbVar()
  const dbKeys = new Set<string>([
    "NV_MONGO_URI",
    "NV_MONGO_DB",
    "NV_MONGO_COLLECTION",
    "NV_MONGO_COLLECTIONS",
  ]);

  const isDbKey = dbKeys.has(key);

  if (isDbKey) {
    // Best-effort context for the error message.
    const envLabel =
      typeof svcEnv.getEnvLabel === "function"
        ? svcEnv.getEnvLabel()
        : safeGetEnvLabel(svcEnv);

    const slug =
      typeof svcEnv.slug === "string" ? svcEnv.slug : safeGetSlug(svcEnv);
    const version =
      typeof svcEnv.version === "number"
        ? svcEnv.version
        : safeGetVersion(svcEnv);

    const msg =
      `ENV_DBVAR_USE_GETDBVAR: "${key}" is DB-related and must be accessed via getDbVar("${key}"). ` +
      `Context: env="${envLabel}", slug="${slug}", version=${version}. ` +
      "Ops: update callers to use getDbVar() so DB_STATE-aware naming and guardrails are enforced.";

    log.error(
      {
        event: "getVar_db_key_forbidden",
        handler: handlerName,
        key,
        env: envLabel,
        slug,
        version,
      },
      msg
    );

    // This is the guardrail that callers see if they misuse getVar().
    throw new Error(msg);
  }

  // Non-DB key: delegate to svcEnv.getEnvVar()
  try {
    const value: string = svcEnv.getEnvVar(key);
    if (!value && required) {
      log.error(
        {
          event: "getVar_required_empty",
          handler: handlerName,
          key,
        },
        `Required svc env var '${key}' is empty.`
      );
      throw new Error(
        `[EnvVarMissing] Required svc env var '${key}' is empty or falsy.`
      );
    }
    return value || undefined;
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    log.error(
      {
        event: "getVar_getter_threw",
        handler: handlerName,
        key,
        required,
        error: errMsg,
      },
      `getVar('${key}', ${required}) — svcEnv.getEnvVar() threw`
    );

    if (required) {
      throw new Error(
        `[EnvVarMissing] Required svc env var '${key}' could not be read (getter threw).`
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
 * - Reads BOTH NV_MONGO_URI and NV_MONGO_DB via svcEnv.getDbVar():
 *     • uri   = svcEnv.getDbVar("NV_MONGO_URI")
 *     • db    = svcEnv.getDbVar("NV_MONGO_DB")
 * - getDbVar() is responsible for applying ADR-0074's DB_STATE semantics:
 *     • domain DBs: <NV_MONGO_DB>_<DB_STATE>
 *     • *_infra DBs: ignore DB_STATE
 *
 * This function NEVER calls getEnvVarFromSvcEnv() for DB vars, so it does not
 * trip the guardrail that protects HandlerBase.getVar().
 */
export function resolveMongoConfigWithDbState(args: ResolveMongoConfigArgs): {
  uri: string;
  dbName: string;
} {
  const { controller, log, handlerName } = args;

  const svcEnv: any = controller.getSvcEnv?.();
  if (!svcEnv) {
    const msg =
      "Service environment configuration is unavailable. " +
      "Ops: ensure AppBase/ControllerBase seeds svcEnv from envBootstrap/env-service.";
    log.error(
      {
        event: "mongo_config_svcEnv_missing",
        handler: handlerName,
      },
      msg
    );
    throw new Error(msg);
  }

  const hasGetDbVar = typeof svcEnv.getDbVar === "function";
  if (!hasGetDbVar) {
    const msg =
      "svcEnv.getDbVar is not implemented on this env DTO. " +
      "Ops: implement getDbVar(name: string) per ADR-0074 so DB_STATE-aware DB names can be resolved.";
    log.error(
      {
        event: "mongo_config_getDbVar_missing",
        handler: handlerName,
      },
      msg
    );
    throw new Error(msg);
  }

  let uri: string;
  let dbName: string;

  try {
    uri = svcEnv.getDbVar("NV_MONGO_URI");
    dbName = svcEnv.getDbVar("NV_MONGO_DB");
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    const msg =
      "Failed to resolve Mongo configuration via svcEnv.getDbVar(). " +
      "Ops: verify NV_MONGO_URI, NV_MONGO_DB, DB_STATE, and DB naming rules in env-service.";
    log.error(
      {
        event: "mongo_config_getDbVar_failed",
        handler: handlerName,
        error: errMsg,
      },
      msg
    );
    throw new Error(`${msg} Detail: ${errMsg}`);
  }

  if (!uri || !dbName) {
    const msg =
      "Mongo configuration incomplete: NV_MONGO_URI or NV_MONGO_DB is missing/empty after getDbVar(). " +
      "Ops: fix the env-service document for this service/version.";
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
    },
    "resolveMongoConfigWithDbState: resolved Mongo URI and DB name via svcEnv.getDbVar"
  );

  return { uri, dbName };
}

/** Best-effort helpers for context strings in errors. */
function safeGetEnvLabel(svcEnv: any): string {
  try {
    if (typeof svcEnv.getEnvVar === "function") {
      const v = svcEnv.getEnvVar("NV_ENV");
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    // ignore
  }
  if (typeof svcEnv.env === "string" && svcEnv.env.trim()) {
    return svcEnv.env.trim();
  }
  return "unknown";
}

function safeGetSlug(svcEnv: any): string {
  if (typeof svcEnv.slug === "string" && svcEnv.slug.trim()) {
    return svcEnv.slug.trim();
  }
  return "unknown";
}

function safeGetVersion(svcEnv: any): number {
  if (typeof svcEnv.version === "number" && svcEnv.version > 0) {
    return Math.trunc(svcEnv.version);
  }
  return -1;
}
