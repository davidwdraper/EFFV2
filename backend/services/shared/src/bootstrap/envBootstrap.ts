// backend/services/shared/src/bootstrap/envBootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Shared environment bootstrap for all services that obtain config from env-service.
 * - env-service itself is the only exception; it uses its own local DB-based bootstrap.
 *
 * Responsibilities:
 * - Use SvcClient + SvcEnvClient to:
 *     1) Resolve the current env label for { slug, version }.
 *     2) Fetch the EnvServiceDto config bag for (envLabel, slug, version).
 * - Work in terms of DtoBag<EnvServiceDto> (no naked DTOs cross this boundary).
 * - Derive HTTP host/port from the primary DTO in the bag.
 * - Construct SvcRuntime using the REAL bound logger (no shims).
 * - Enforce posture-derived boot rails (DB requirements).
 *
 * Invariants:
 * - No .env file parsing here except NV_ENV (logical environment label) and NV_ENV_SERVICE_URL
 *   for bootstrapping env-service location.
 * - DTO encapsulation is preserved: SvcRuntime must NOT extract and cache vars outside EnvServiceDto.
 * - All failures log concrete Ops guidance and terminate the process with exit code 1.
 *
 * NOTE (important / current reality):
 * - WAL is NOT a posture-derived requirement today.
 * - WAL is a capability (future: "db.wal") that must be explicitly wired by AppBase.
 * - Therefore: envBootstrap MUST NOT require NV_WAL_DIR (or any WAL vars) just because posture is "db".
 *   If/when WAL is introduced, the validation belongs behind an explicit capability gate (rt.hasCap("db.wal"))
 *   which is not available in envBootstrap (caps are wired later by AppBase).
 */

import fs from "fs";
import path from "path";
import { DtoBag } from "../dto/DtoBag";
import { EnvServiceDto } from "../dto/env-service.dto";
import {
  SvcClient,
  type ISvcClientLogger,
  type ISvcconfigResolver,
  type RequestIdProvider,
  type SvcTarget,
} from "../s2s/SvcClient";
import { SvcEnvClient } from "../env/svcenvClient";
import { SvcRuntime } from "../runtime/SvcRuntime";
import { setLoggerEnv, getLogger, type IBoundLogger } from "../logger/Logger";
import { type SvcPosture, isDbPosture } from "../runtime/SvcPosture";

export type EnvBootstrapOpts = {
  slug: string;
  version: number;

  /**
   * ADR-0084: Service posture is the single source of truth.
   * envBootstrap derives and enforces all boot rails from posture.
   */
  posture: SvcPosture;

  /**
   * Optional explicit startup log path. If omitted, defaults to:
   *   <cwd>/<slug>-startup-error.log
   */
  logFile?: string;
};

export type EnvBootstrapResult = {
  /**
   * Logical environment label for this process (e.g., "dev", "stage", "prod").
   * - Derived once at boot from NV_ENV via SvcEnvClient.getCurrentEnv().
   * - Frozen for the lifetime of the process; envReloader reuses the same value.
   */
  envLabel: string;
  envBag: DtoBag<EnvServiceDto>;
  envReloader: () => Promise<DtoBag<EnvServiceDto>>;
  host: string;
  port: number;

  /**
   * Echo of posture (single source of truth).
   */
  posture: SvcPosture;

  /**
   * ADR-0080: Transport-agnostic runtime container.
   * REQUIRED by AppBase ctor for SvcRuntime services.
   *
   * Encapsulation:
   * - rt holds EnvServiceDto (source of truth), not an extracted vars map.
   */
  rt: SvcRuntime;
};

/** Minimal console-backed logger for SvcClient during bootstrap. */
class BootstrapSvcClientLogger implements ISvcClientLogger {
  debug(msg: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.debug(msg, meta ?? {});
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.info(msg, meta ?? {});
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.warn(msg, meta ?? {});
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.error(msg, meta ?? {});
  }
}

/**
 * Bootstrap svcconfig resolver for envBootstrap.
 *
 * Purpose:
 * - Avoid svcconfig recursion on first boot.
 * - Resolve ONLY env-service using NV_ENV_SERVICE_URL.
 *
 * Env:
 * - NV_ENV_SERVICE_URL: base URL for env-service
 */
class BootstrapEnvSvcResolver implements ISvcconfigResolver {
  public async resolveTarget(
    _env: string,
    slug: string,
    version: number
  ): Promise<SvcTarget> {
    if (slug !== "env-service") {
      throw new Error(
        `BOOTSTRAP_SVCCONFIG_RESOLVER_UNSUPPORTED_TARGET: This bootstrap resolver only supports slug="env-service". ` +
          `Got slug="${slug}@v${version}". ` +
          "Ops: ensure only env-service is called during envBootstrap, or replace this resolver with a full svcconfig-backed implementation."
      );
    }

    const raw = process.env.NV_ENV_SERVICE_URL;
    const baseUrl = typeof raw === "string" ? raw.trim() : "";

    if (!baseUrl) {
      throw new Error(
        "BOOTSTRAP_ENV_SERVICE_URL_MISSING: NV_ENV_SERVICE_URL is not set or empty. " +
          "Ops: set NV_ENV_SERVICE_URL to the base URL of env-service " +
          '(e.g., "http://127.0.0.1:4001") before starting this service.'
      );
    }

    return {
      baseUrl,
      slug: "env-service",
      version,
      isAuthorized: true,
    };
  }
}

/** Simple requestId provider for bootstrap-time SvcClient. */
const bootstrapRequestIdProvider: RequestIdProvider = () =>
  `bootstrap-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

/** Resolve log file path (default to per-service startup log). */
function resolveLogFile(slug: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  const safeSlug = slug.trim() || "service";
  return path.resolve(process.cwd(), `${safeSlug}-startup-error.log`);
}

/** Log a fatal bootstrap error to console + file, then exit. */
function fatal(logFile: string, message: string, err?: unknown): never {
  const detail =
    err && err instanceof Error
      ? `${err.name}: ${err.message}`
      : err
      ? String(err)
      : "";
  const text = `[${new Date().toISOString()}] ${message}${
    detail ? ` — ${detail}` : ""
  }`;

  try {
    fs.writeFileSync(logFile, text + "\n", { flag: "a" });
  } catch {
    // ignore
  }

  // eslint-disable-next-line no-console
  console.error(text);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

function requireNonEmpty(s: unknown, code: string, detail: string): string {
  const v = typeof s === "string" ? s.trim() : "";
  if (!v) throw new Error(`${code}: ${detail}`);
  return v;
}

function requirePositiveIntString(
  raw: string,
  code: string,
  detail: string
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${code}: ${detail} Got "${raw}".`);
  }
  return Math.trunc(n);
}

function enforcePostureRails(
  logFile: string,
  posture: SvcPosture,
  envLabel: string,
  slug: string,
  version: number,
  envDto: EnvServiceDto
): void {
  /**
   * DB posture: require ONLY DB vars here.
   *
   * WAL is a capability (future "db.wal"), not a posture rail today, and
   * envBootstrap cannot know which caps will be wired (that happens in AppBase).
   *
   * Therefore: DO NOT validate WAL vars here.
   */
  if (isDbPosture(posture)) {
    try {
      requireNonEmpty(
        envDto.getDbVar("NV_MONGO_URI"),
        "BOOTSTRAP_MONGO_URI_MISSING",
        `NV_MONGO_URI is required for posture="db" (env="${envLabel}", slug="${slug}", version=${version}). ` +
          "Ops: set NV_MONGO_URI in env-service."
      );
      requireNonEmpty(
        envDto.getDbVar("NV_MONGO_DB"),
        "BOOTSTRAP_MONGO_DB_MISSING",
        `NV_MONGO_DB is required for posture="db" (env="${envLabel}", slug="${slug}", version=${version}). ` +
          "Ops: set NV_MONGO_DB in env-service."
      );
    } catch (err) {
      fatal(
        logFile,
        "BOOTSTRAP_DB_VARS_INVALID: DB posture requires Mongo vars.",
        err
      );
    }
  }

  // Non-db postures: do NOT validate DB vars here; they are forbidden by design,
  // but we avoid probing DTO internals for key existence to preserve encapsulation.
}

export async function envBootstrap(
  opts: EnvBootstrapOpts
): Promise<EnvBootstrapResult> {
  const { slug, version, posture } = opts;
  const logFile = resolveLogFile(slug, opts.logFile);

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap starting", { slug, version, posture });

  // 1) Construct SvcClient and SvcEnvClient
  let svcClient: SvcClient;
  try {
    svcClient = new SvcClient({
      callerSlug: slug,
      callerVersion: version,
      logger: new BootstrapSvcClientLogger(),
      svcconfigResolver: new BootstrapEnvSvcResolver(),
      requestIdProvider: bootstrapRequestIdProvider,
    });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_SVCCLIENT_INIT_FAILED: Failed to construct SvcClient for envBootstrap. " +
        "Ops: verify NV_ENV_SERVICE_URL is set and valid.",
      err
    );
  }

  const envClient = new SvcEnvClient({ svcClient });

  // 2) Resolve current env label (frozen)
  let envLabel: string;
  try {
    envLabel = await envClient.getCurrentEnv({ slug, version });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_CURRENT_ENV_FAILED: Failed to resolve current logical env label for " +
        `slug="${slug}", version=${version}. ` +
        "Ops: ensure NV_ENV is set for this service before start.",
      err
    );
  }

  // 3) Fetch EnvServiceDto config bag
  let envBag: DtoBag<EnvServiceDto>;
  try {
    envBag = await envClient.getConfig({ env: envLabel, slug, version });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_CONFIG_FAILED: Failed to fetch EnvServiceDto bag from env-service. " +
        `Ops: ensure a config document exists for env="${envLabel}", slug="${slug}", version=${version}.`,
      err
    );
  }

  // 4) Primary DTO = first item (no iterator loop drift)
  const first = envBag.items().next();
  const primary: EnvServiceDto | undefined = first.done
    ? undefined
    : first.value;

  if (!primary) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_BAG_EMPTY: EnvServiceDto bag was empty after successful fetch. " +
        "Ops: investigate env-service collection contents; this should not happen."
    );
  }

  // 5) Configure REAL logger from envDto (no shims) and bind bootstrap context.
  try {
    setLoggerEnv(primary);
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_LOGGER_ENV_FAILED: Failed to initialize logger from EnvServiceDto. " +
        "Ops/Dev: ensure env-service provides required logger vars (e.g., LOG_LEVEL).",
      err
    );
  }

  let log: IBoundLogger;
  try {
    log = getLogger({ service: slug, component: "envBootstrap" });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_LOGGER_GET_FAILED: Failed to obtain bound logger after setLoggerEnv(). " +
        "Ops/Dev: verify Logger.getLogger wiring.",
      err
    );
  }

  // 6) Enforce posture-derived rails (DB requirements only; WAL is cap-driven)
  enforcePostureRails(logFile, posture, envLabel, slug, version, primary);

  // 7) Derive HTTP host/port
  let host: string;
  let port: number;
  try {
    host = requireNonEmpty(
      primary.getEnvVar("NV_HTTP_HOST"),
      "BOOTSTRAP_HTTP_HOST_MISSING",
      `NV_HTTP_HOST is required for env="${envLabel}", slug="${slug}", version=${version}. ` +
        "Ops: set NV_HTTP_HOST in env-service for this service."
    );

    const rawPort = primary.getEnvVar("NV_HTTP_PORT");
    port = requirePositiveIntString(
      rawPort,
      "BOOTSTRAP_HTTP_PORT_INVALID",
      `NV_HTTP_PORT must be a positive integer string for env="${envLabel}", slug="${slug}", version=${version}.`
    );
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_HTTP_CONFIG_INVALID: Failed to derive NV_HTTP_HOST/NV_HTTP_PORT " +
        `from EnvServiceDto for env="${envLabel}", slug="${slug}", version=${version}. ` +
        "Ops: ensure these keys exist and are valid.",
      err
    );
  }

  // 8) Build SvcRuntime (ADR-0080) from identity + EnvServiceDto + REAL logger
  let dbStateRaw: string;
  try {
    dbStateRaw = primary.getEnvVar("DB_STATE");
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_DB_STATE_MISSING: DB_STATE is required for SvcRuntime identity. " +
        `Ops: add DB_STATE to env-service config for env="${envLabel}", slug="${slug}", version=${version}.`,
      err
    );
  }

  const dbState = requireNonEmpty(
    dbStateRaw,
    "BOOTSTRAP_DB_STATE_MISSING",
    `DB_STATE is required for env="${envLabel}", slug="${slug}", version=${version}. ` +
      'Ops: set "DB_STATE" in env-service for this service.'
  );

  let rt: SvcRuntime;
  try {
    rt = new SvcRuntime(
      {
        serviceSlug: slug,
        serviceVersion: version,
        env: envLabel,
        dbState,
      },
      primary, // DTO stays the source of truth
      log,
      {} // caps are wired ONLY by AppBase (ADR-0084 posture rails + ADR-0080 caps model)
    );
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_RT_CONSTRUCT_FAILED: Failed to construct SvcRuntime. " +
        "Ops/Dev: verify EnvServiceDto + logger wiring.",
      err
    );
  }

  // 9) Bag-based reloader: same envLabel, fresh bag each call.
  const envReloader = async (): Promise<DtoBag<EnvServiceDto>> => {
    return envClient.getConfig({ env: envLabel, slug, version });
  };

  log.info(
    {
      event: "env_bootstrap_complete",
      slug,
      version,
      envLabel,
      host,
      port,
      posture,
    },
    "envBootstrap complete"
  );

  return {
    envLabel,
    envBag,
    envReloader,
    host,
    port,
    posture,
    rt,
  };
}
