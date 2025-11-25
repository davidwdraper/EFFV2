// backend/services/shared/src/bootstrap/envBootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *
 * Purpose:
 * - Shared environment bootstrap for all services that obtain config from env-service.
 * - env-service itself is the only exception; it uses its own local DB-based bootstrap.
 *
 * Responsibilities:
 * - Use SvcClient + SvcEnvClient to:
 *     1) Resolve the current env for { slug, version }.
 *     2) Fetch the EnvServiceDto config bag for (env, slug, version).
 * - Work in terms of DtoBag<EnvServiceDto> (no naked DTOs cross this boundary).
 * - Derive HTTP host/port from the primary DTO in the bag.
 * - Expose:
 *     • envName   (logical environment for this process; frozen for lifetime)
 *     • a bag-based envReloader with the same env semantics.
 *
 * Invariants:
 * - No .env file parsing here except NV_ENV (logical environment) and NV_ENV_SERVICE_URL
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
   * Logical environment name for this process (e.g., "dev", "stage", "prod").
   * - Derived once at boot from NV_ENV via SvcEnvClient.getCurrentEnv().
   * - Frozen for the lifetime of the process; envReloader reuses the same value.
   */
  envName: string;
  envBag: DtoBag<EnvServiceDto>;
  envReloader: () => Promise<DtoBag<EnvServiceDto>>;
  host: string;
  port: number;
  /**
   * Echo of opts.checkDb so downstream boot code can decide whether to
   * enforce NV_MONGO_* + ensureIndexes() or skip all DB concerns.
   */
  checkDb: boolean;
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
 *   (e.g., "http://127.0.0.1:4001" or "https://env-service.dev.internal:8443").
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

    const target: SvcTarget = {
      baseUrl,
      slug: "env-service",
      version,
      isAuthorized: true,
    };

    return target;
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
    // If we can't write the file, we still log to console.
  }

  // eslint-disable-next-line no-console
  console.error(text);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

/**
 * Shared bootstrap for non-env-service backends.
 *
 * Flow:
 * - Instantiates SvcClient (callerSlug/version = opts.slug/version) using:
 *     • console-backed logger
 *     • BootstrapEnvSvcResolver (NV_ENV_SERVICE_URL → env-service baseUrl)
 *     • bootstrapRequestIdProvider
 * - Uses SvcEnvClient to:
 *     • getCurrentEnv({ slug, version })  → envName (once, frozen)
 *     • getConfig({ env: envName, slug, version }) → DtoBag<EnvServiceDto>
 * - Derives host/port from the primary DTO in the bag.
 * - Returns:
 *     • envName    (logical env for this process)
 *     • envBag     (config bag)
 *     • envReloader (same env, fresh bag each call)
 *     • host/port
 *     • checkDb    (echo of opts.checkDb for downstream boot logic)
 */
export async function envBootstrap(
  opts: EnvBootstrapOpts
): Promise<EnvBootstrapResult> {
  const { slug, version, checkDb } = opts;
  const logFile = resolveLogFile(slug, opts.logFile);

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap starting", { slug, version, checkDb });

  // 1) Construct SvcClient (new API) and SvcEnvClient
  let svcClient: SvcClient;
  try {
    svcClient = new SvcClient({
      callerSlug: slug,
      callerVersion: version,
      logger: new BootstrapSvcClientLogger(),
      svcconfigResolver: new BootstrapEnvSvcResolver(),
      requestIdProvider: bootstrapRequestIdProvider,
      // tokenFactory is optional until S2S auth is fully enforced.
    });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_SVCCLIENT_INIT_FAILED: Failed to construct SvcClient for envBootstrap. " +
        "Ops: verify NV_ENV_SERVICE_URL is set and valid, and that no unexpected constructor errors occur.",
      err
    );
  }

  const envClient = new SvcEnvClient({
    svcClient,
  });

  // 2) Resolve current env for this service (once, frozen for process lifetime)
  let envName: string;
  try {
    envName = await envClient.getCurrentEnv({ slug, version });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_CURRENT_ENV_FAILED: Failed to resolve current logical env for " +
        `slug="${slug}", version=${version}. ` +
        "Ops: ensure NV_ENV is set (e.g., 'dev', 'stage', 'prod') for this service before start.",
      err
    );
  }

  // 3) Fetch EnvServiceDto config bag for that env/slug/version
  let envBag: DtoBag<EnvServiceDto>;
  try {
    envBag = await envClient.getConfig({ env: envName, slug, version });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_CONFIG_FAILED: Failed to fetch EnvServiceDto bag from env-service. " +
        `Ops: ensure a config document exists for env="${envName}", slug="${slug}", version=${version} ` +
        "and that env-service indexes allow fast lookup by (env, slug, version).",
      err
    );
  }

  // 4) Derive listener host/port from the primary DTO in the bag
  let primary: EnvServiceDto | undefined;
  for (const dto of envBag) {
    primary = dto;
    break;
  }

  if (!primary) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_BAG_EMPTY: EnvServiceDto bag was empty after successful fetch. " +
        "Ops: investigate env-service collection contents; this should not happen."
    );
  }

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

  // 5) Bag-based reloader: same envName, same client, fresh bag each call.
  const envReloader = async (): Promise<DtoBag<EnvServiceDto>> => {
    return envClient.getConfig({ env: envName, slug, version });
  };

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap complete", {
    slug,
    version,
    envName,
    host,
    port,
    checkDb,
  });

  return {
    envName,
    envBag,
    envReloader,
    host,
    port,
    checkDb,
  };
}
