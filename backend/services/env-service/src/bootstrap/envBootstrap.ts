// backend/services/env-service/src/bootstrap/envBootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (DbEnvServiceDto — one doc per env@slug@version)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0074 (DB_STATE + _infra state-invariant DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Bootstrap env-service without svcenvClient or SvcEnvDto.
 * - Read DB connection details from process.env (.env file).
 * - Use DbReader + EnvConfigReader to load this service's DbEnvServiceDto config.
 * - Apply the same root+service merge rules used by the HTTP /config pipeline:
 *     • root slug: "service-root"
 *     • service slug: opts.slug (e.g., "env-service")
 * - Return:
 *     • rt: constructed from envLabel + DB_STATE + merged DbEnvServiceDto
 *     • envBag: merged DtoBag<DbEnvServiceDto>
 *     • envReloader: () => Promise<DtoBag<DbEnvServiceDto>> (same merge logic; updates rt in-place)
 *     • host/port: derived via rt vars
 *
 * Rules:
 * - No naked DTOs cross this boundary: always a DtoBag in/out.
 * - Bootstrap may read process.env ONLY here (env-service special-case).
 * - Canonical DB keys for ALL services (including env-service) are:
 *     • NV_MONGO_URI
 *     • NV_MONGO_DB
 *
 * Guardrail (critical):
 * - The bootstrap DB MUST be state-invariant and end with "_infra".
 * - If it does not, we hard-fail to avoid silently creating a fresh DB via DB_STATE decoration.
 */

import fs from "fs";
import path from "path";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { DbReader } from "@nv/shared/dto/persistence/dbReader/DbReader";
import { EnvConfigReader } from "../svc/EnvConfigReader";
import {
  setLoggerEnv,
  getLogger,
  type IBoundLogger,
} from "@nv/shared/logger/Logger";
import { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

type BootstrapOpts = {
  slug: string;
  version: number;
  logFile?: string;
};

export type EnvBootstrapResult = {
  rt: SvcRuntime;
  envBag: DtoBag<DbEnvServiceDto>;
  envReloader: () => Promise<DtoBag<DbEnvServiceDto>>;
  host: string;
  port: number;
};

/** Resolve log file path (default to service root file). */
function resolveLogFile(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  return path.resolve(process.cwd(), "env-service-startup-error.log");
}

/** Log a fatal bootstrap error to console + file, then exit. */
function fatal(logFile: string, message: string, err?: unknown): never {
  const text = `[${new Date().toISOString()}] ${message}${
    err ? ` — ${(err as Error)?.message ?? String(err)}` : ""
  }`;
  try {
    fs.writeFileSync(logFile, text + "\n", { flag: "a" });
  } catch {
    // If we can't write the file, we still log to console.
  }
  // eslint-disable-next-line no-console
  console.error(text);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

/** Require an env var, log to file on failure, and exit. */
function requireEnv(name: string, logFile: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    fatal(
      logFile,
      `BOOTSTRAP_ENV_MISSING: Required env "${name}" is not set. ` +
        "Ops: add this key to the appropriate .env file for env-service and restart."
    );
  }
  return v.trim();
}

/**
 * Enforce that the bootstrap DB is state-invariant ("_infra").
 * This prevents accidental boot against a stateful base name which would
 * cause DB_STATE decoration to create a fresh DB and “lose” config.
 */
function requireInfraDbName(mongoDb: string, logFile: string): string {
  const db = (mongoDb ?? "").trim();
  if (!db) {
    fatal(
      logFile,
      'BOOTSTRAP_DBNAME_EMPTY: NV_MONGO_DB is empty. Ops: set NV_MONGO_DB (e.g., "nv_env_infra").'
    );
  }

  if (!db.toLowerCase().endsWith("_infra")) {
    fatal(
      logFile,
      `BOOTSTRAP_DBNAME_NOT_INFRA: NV_MONGO_DB="${db}" must end with "_infra" for env-service bootstrap. ` +
        'Ops: point env-service at a state-invariant bootstrap DB (e.g., "nv_env_infra").'
    );
  }

  return db;
}

/**
 * Bootstrap env-service:
 * - Reads DB config from env (NV_MONGO_URI / NV_MONGO_DB).
 * - Uses DbReader + EnvConfigReader.getEnv() to fetch:
 *     • rootBag: (envLabel, slug="service-root", version)
 *     • svcBag : (envLabel, slug=opts.slug,      version)
 * - Uses EnvConfigReader.mergeEnvBags(rootBag, svcBag) to get a single merged bag.
 * - Constructs SvcRuntime from:
 *     • envLabel (process.env bootstrap-only)
 *     • DB_STATE (from merged DbEnvServiceDto)
 *     • merged DbEnvServiceDto (lives inside rt only)
 * - Derives HTTP host/port via rt vars.
 */
export async function envBootstrap(
  opts: BootstrapOpts
): Promise<EnvBootstrapResult> {
  const logFile = resolveLogFile(opts.logFile);
  const { slug, version } = opts;

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap starting", { slug, version });

  // 1) Required DB config from env (.env file)
  const mongoUri = requireEnv("NV_MONGO_URI", logFile);
  const mongoDbRaw = requireEnv("NV_MONGO_DB", logFile);
  const mongoDb = requireInfraDbName(mongoDbRaw, logFile);

  // 2) Determine current logical environment label (no fallbacks).
  const envLabel = requireEnv("NV_ENV", logFile);

  // 3) Initialize DbReader (shared with handlers)
  let dbReader: DbReader<DbEnvServiceDto>;
  try {
    dbReader = new DbReader<DbEnvServiceDto>({
      dtoCtor: DbEnvServiceDto,
      mongoUri,
      mongoDb,
    });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_DBREADER_INIT_FAILED: Failed to construct DbReader. " +
        "Ops: verify NV_MONGO_URI/NV_MONGO_DB configuration for env-service.",
      err
    );
  }

  // 4) Load root + service bags, then merge via EnvConfigReader.mergeEnvBags().
  let envBag: DtoBag<DbEnvServiceDto>;
  try {
    const rootBag = await EnvConfigReader.getEnv(dbReader, {
      env: envLabel,
      slug: "service-root",
      version,
    }).catch((err) => {
      if (err) {
        throw new Error(
          `ROOT_CONFIG_READ_FAILED: ${String(
            (err as Error)?.message ?? err
          )}. Ops: check DB connectivity and indexes.`
        );
      }
      return new DtoBag<DbEnvServiceDto>([]);
    });

    const svcBag = await EnvConfigReader.getEnv(dbReader, {
      env: envLabel,
      slug,
      version,
    }).catch((err) => {
      if (err) {
        throw new Error(
          `SERVICE_CONFIG_READ_FAILED: ${String(
            (err as Error)?.message ?? err
          )}. Ops: check DB connectivity and indexes.`
        );
      }
      return new DtoBag<DbEnvServiceDto>([]);
    });

    envBag = EnvConfigReader.mergeEnvBags(rootBag, svcBag);
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_CONFIG_FAILED: Failed to load/merge env-service configuration. " +
        `Ops: ensure at least one env-service document exists for envLabel="${envLabel}", slug in {"service-root","${slug}"}, version=${version}.`,
      err
    );
  }

  // 5) Select primary DTO (internal only) and construct rt.
  let primary: DbEnvServiceDto | undefined;
  for (const dto of envBag as unknown as Iterable<DbEnvServiceDto>) {
    primary = dto;
    break;
  }

  if (!primary) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_BAG_EMPTY: merged DbEnvServiceDto bag was empty after successful merge. " +
        "Ops: investigate env-service collection contents; this should not happen."
    );
  }

  // Logger is strict and requires SvcEnv; once primary exists we can bind it.
  let log: IBoundLogger;
  try {
    setLoggerEnv(primary);
    log = getLogger({
      service: slug,
      component: "envBootstrap",
      event: "bootstrap",
      envLabel,
      version,
    }).bind({ bootstrapDb: mongoDb });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_LOGGER_INIT_FAILED: Failed to initialize shared logger from merged DbEnvServiceDto. " +
        "Ops: ensure LOG_LEVEL exists in env-service config (root/service merge) and is valid.",
      err
    );
  }

  let rt: SvcRuntime;
  try {
    // DB_STATE comes from DbEnvServiceDto (ADR-0074). env-service bootstrap DB remains _infra and is NOT decorated.
    const dbState = primary.getEnvVar("DB_STATE");

    rt = new SvcRuntime(
      {
        serviceSlug: slug,
        serviceVersion: version,
        env: envLabel,
        dbState,
      },
      primary,
      log
    );
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_RT_INIT_FAILED: Failed to construct SvcRuntime for env-service. " +
        "Ops: ensure DB_STATE exists in env-service config (root/service merge) and is non-empty.",
      err
    );
  }

  // 6) Derive listener host/port via rt vars (single source of truth).
  let host: string;
  let port: number;
  try {
    host = rt.getVar("NV_HTTP_HOST");
    port = rt.getPositiveIntVar("NV_HTTP_PORT");
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_HTTP_CONFIG_INVALID: Failed to derive NV_HTTP_HOST/NV_HTTP_PORT via SvcRuntime. " +
        "Ops: ensure these keys exist and are valid (after root/service merge).",
      err
    );
  }

  // 7) DtoBag-based reloader: same reader, same logic, fresh bag. Updates rt in-place.
  const envReloader = async (): Promise<DtoBag<DbEnvServiceDto>> => {
    const nextEnvLabel = requireEnv("NV_ENV", logFile);

    const nextRootBag = await EnvConfigReader.getEnv(dbReader, {
      env: nextEnvLabel,
      slug: "service-root",
      version,
    }).catch(() => new DtoBag<DbEnvServiceDto>([]));

    const nextSvcBag = await EnvConfigReader.getEnv(dbReader, {
      env: nextEnvLabel,
      slug,
      version,
    }).catch(() => new DtoBag<DbEnvServiceDto>([]));

    const nextBag = EnvConfigReader.mergeEnvBags(nextRootBag, nextSvcBag);

    let nextPrimary: DbEnvServiceDto | undefined;
    for (const dto of nextBag as unknown as Iterable<DbEnvServiceDto>) {
      nextPrimary = dto;
      break;
    }

    if (!nextPrimary) {
      throw new Error(
        `ENV_RELOAD_EMPTY_BAG: merged DbEnvServiceDto bag was empty for env="${nextEnvLabel}", slug="${slug}", version=${version}. ` +
          "Ops: ensure config docs exist and merge produces at least one DbEnvServiceDto."
      );
    }

    // Single source of truth: update rt only.
    rt.setEnvDto(nextPrimary);
    return nextBag;
  };

  log.info(
    { host, port, envLabel, bootstrapDb: mongoDb, rt: rt.describe() },
    "envBootstrap complete"
  );

  return {
    rt,
    envBag,
    envReloader,
    host,
    port,
  };
}
