// backend/services/shared/src/bootstrap/envBootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
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
 * - Construct SvcSandbox using the REAL bound logger (no shims).
 *
 * Invariants:
 * - No .env file parsing here except NV_ENV (logical environment label) and NV_ENV_SERVICE_URL
 *   for bootstrapping env-service location.
 * - All failures log concrete Ops guidance and terminate the process with exit code 1.
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
import { SvcSandbox } from "../sandbox/SvcSandbox";
import type { IBoundLogger } from "../logger/Logger";
import { setLoggerEnv, getLogger } from "../logger/Logger";

export type EnvBootstrapOpts = {
  slug: string;
  version: number;
  /**
   * CHECK_DB:
   * - true  => service is DB-backed; callers are expected to:
   *            • enforce NV_MONGO_* presence
   *            • run registry.ensureIndexes() at boot
   * - false => MOS / non-DB service; callers should NOT touch NV_MONGO_* or indexes.
   *
   * NOTE:
   * - This flag is intentionally required so new services (or cloner output)
   *   must explicitly declare their DB posture.
   */
  checkDb: boolean;
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
   * Echo of opts.checkDb so downstream boot code can decide whether to
   * enforce NV_MONGO_* + ensureIndexes() or skip all DB concerns.
   */
  checkDb: boolean;

  /**
   * ADR-0080: Transport-agnostic runtime container.
   * REQUIRED by AppBase ctor for SvcSandbox services.
   */
  ssb: SvcSandbox;
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

/**
 * Extract merged vars map from EnvServiceDto.
 * We rely on DTO truth here; no defaults and no silent missing values.
 */
function extractVars(
  primary: EnvServiceDto,
  logFile: string
): Record<string, string> {
  const body = (primary as any)?.toBody?.();
  const vars = body?.vars;

  if (!vars || typeof vars !== "object") {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_VARS_MISSING: EnvServiceDto.toBody() did not yield a vars map. " +
        "Ops: ensure EnvServiceDto includes 'vars: Record<string,string>' and env-service returns it."
    );
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim()) continue;
    if (typeof v !== "string") continue;
    const kk = k.trim();
    const vv = v.trim();
    if (!vv) continue;
    out[kk] = vv;
  }
  return out;
}

export async function envBootstrap(
  opts: EnvBootstrapOpts
): Promise<EnvBootstrapResult> {
  const { slug, version, checkDb } = opts;
  const logFile = resolveLogFile(slug, opts.logFile);

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap starting", { slug, version, checkDb });

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

  // 5) Configure REAL logger from envDto and bind bootstrap context.
  // NOTE: This must use the production logger pipeline (no shims).
  try {
    setLoggerEnv(primary);
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_LOGGER_ENV_FAILED: Failed to initialize logger from EnvServiceDto. " +
        "Ops/Dev: ensure env-service provides required logger vars (e.g., log level/service URLs).",
      err
    );
  }

  let log: IBoundLogger;
  try {
    // If your logger getter has a different name, replace this ONE symbol.
    log = getLogger().bind({
      service: slug,
      version,
      component: "bootstrap",
      env: envLabel,
    });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_LOGGER_GET_FAILED: Failed to obtain bound logger after setLoggerEnv(). " +
        "Ops/Dev: verify logger module exports a getter for the bound logger instance.",
      err
    );
  }

  // 6) Derive HTTP host/port
  let host: string;
  let port: number;
  try {
    host = primary.getEnvVar("NV_HTTP_HOST");
    const rawPort = primary.getEnvVar("NV_HTTP_PORT");
    const n = Number(rawPort);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(
        `NV_HTTP_PORT must be a positive integer, got "${rawPort}". ` +
          "Ops: correct this value in the env-service config document for this service."
      );
    }
    port = Math.trunc(n);
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_HTTP_CONFIG_INVALID: Failed to derive NV_HTTP_HOST/NV_HTTP_PORT " +
        "from the EnvServiceDto in the config bag. Ops: ensure these keys exist and hold valid values.",
      err
    );
  }

  // 7) Build SvcSandbox (ADR-0080) from identity + vars + REAL logger
  const vars = extractVars(primary, logFile);

  let dbState: string;
  try {
    dbState = primary.getEnvVar("DB_STATE");
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_DB_STATE_MISSING: DB_STATE is required for SvcSandbox identity. " +
        `Ops: add DB_STATE to env-service config for env="${envLabel}", slug="${slug}", version=${version}.`,
      err
    );
  }

  let ssb: SvcSandbox;
  try {
    ssb = new SvcSandbox(
      {
        serviceSlug: slug,
        serviceVersion: version,
        env: envLabel,
        dbState,
      },
      vars,
      log,
      {}
    );
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_SSB_CONSTRUCT_FAILED: Failed to construct SvcSandbox. " +
        "Ops/Dev: verify env-service vars map and logger wiring.",
      err
    );
  }

  // 8) Bag-based reloader: same envLabel, fresh bag each call.
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
      checkDb,
    },
    "envBootstrap complete"
  );

  return {
    envLabel,
    envBag,
    envReloader,
    host,
    port,
    checkDb,
    ssb,
  };
}
