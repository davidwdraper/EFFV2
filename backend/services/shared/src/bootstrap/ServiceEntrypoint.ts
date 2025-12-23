// backend/services/shared/src/bootstrap/ServiceEntrypoint.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Shared async entrypoint helper for HTTP services.
 * - Owns envBootstrap + EnvServiceDto selection + reloader adaptation +
 *   SvcSandbox construction + listen() + fatal error handling.
 *
 * Notes:
 * - env-service is the exception: it uses its own local bootstrap and does NOT
 *   use this entrypoint. Updating this file does not invalidate env-service.
 */

import fs from "fs";
import path from "path";
import { envBootstrap } from "@nv/shared/bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import {
  setLoggerEnv,
  getLogger,
  type IBoundLogger,
} from "@nv/shared/logger/Logger";
import {
  SvcSandbox,
  type SvcSandboxIdentity,
} from "@nv/shared/sandbox/SvcSandbox";

export interface ServiceEntrypointOptions {
  slug: string;
  version: number;
  /**
   * If true, envBootstrap will verify DB connectivity/indexes as part of boot.
   * For non-DB daemons or special cases, this can be false.
   */
  checkDb?: boolean;
  /**
   * Optional override for the startup error log filename.
   * Defaults to "<slug>-startup-error.log" in process.cwd().
   */
  logFileBasename?: string;

  /**
   * Service-specific app factory. Must construct and return an object that
   * exposes an Express-compatible `listen(port, host, cb)` function.
   *
   * Invariants:
   * - SvcSandbox is mandatory and MUST be injected.
   * - envLabel is provided for convenience, but AppBase must source envLabel
   *   from ssb (ADR-0080 Commit 2).
   */
  createApp: (opts: {
    slug: string;
    version: number;
    envLabel: string;
    envDto: EnvServiceDto;
    envReloader: () => Promise<EnvServiceDto>;
    ssb: SvcSandbox;
  }) => Promise<{
    app: {
      listen: (port: number, host: string, cb: () => void) => void;
    };
  }>;
}

function requireNonEmpty(s: unknown, code: string, detail: string): string {
  const v = typeof s === "string" ? s.trim() : "";
  if (!v) throw new Error(`${code}: ${detail}`);
  return v;
}

export async function runServiceEntrypoint(
  opts: ServiceEntrypointOptions
): Promise<void> {
  const { slug, version, createApp, checkDb = true } = opts;
  const logFileBasename = opts.logFileBasename ?? `${slug}-startup-error.log`;
  const logFile = path.resolve(process.cwd(), logFileBasename);

  try {
    // Step 1: Bootstrap and load configuration (env-service-backed config)
    const { envLabel, envBag, envReloader, host, port } = await envBootstrap({
      slug,
      version,
      logFile,
      checkDb,
    });

    // Step 2: Extract the primary EnvServiceDto from the bag (should be exactly one)
    let primary: EnvServiceDto | undefined;
    for (const dto of envBag) {
      primary = dto;
      break;
    }

    if (!primary) {
      throw new Error(
        "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No EnvServiceDto in envBag after envBootstrap. " +
          "Ops: verify env-service has a config record for this service (env@slug@version) " +
          "and that envBootstrap is querying with the correct keys."
      );
    }

    // IMPORTANT:
    // Logger requires SvcEnv to be set (LOG_LEVEL is strict).
    // We set it here so sandbox + any early logs are safe.
    setLoggerEnv(primary);

    const log: IBoundLogger = getLogger({
      service: slug,
      component: "ServiceEntrypoint",
    });

    // Step 3: Adapt the bag-based reloader into a single-DTO reloader for the AppBase/logger.
    const envReloaderForApp = async (): Promise<EnvServiceDto> => {
      const bag: DtoBag<EnvServiceDto> = await envReloader();
      for (const dto of bag) {
        return dto;
      }
      throw new Error(
        "ENV_RELOADER_EMPTY_BAG: envReloader returned an empty bag. " +
          "Ops: ensure the service’s EnvServiceDto config record still exists in env-service " +
          "and matches (env, slug, version) expected by envBootstrap."
      );
    };

    // Step 4: Construct SvcSandbox (ADR-0080)
    const vars = primary.getVarsRaw();

    const dbState = requireNonEmpty(
      vars["DB_STATE"],
      "ENTRYPOINT_DB_STATE_MISSING",
      `DB_STATE is required in env-service vars for env="${envLabel}", slug="${slug}", version=${version}. ` +
        'Ops: set "DB_STATE" in env-service for this service.'
    );

    const ident: SvcSandboxIdentity = {
      serviceSlug: slug,
      serviceVersion: version,
      env: envLabel,
      dbState,
    };

    const ssb = new SvcSandbox(ident, vars, log, {});

    // Step 5: Construct and boot the service app.
    const { app } = await createApp({
      slug,
      version,
      envLabel, // convenience only; AppBase must source env from ssb
      envDto: primary,
      envReloader: envReloaderForApp,
      ssb,
    });

    // Step 6: Start listening.
    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.info("[entrypoint] http_listening", {
        slug,
        version,
        envLabel,
        host,
        port,
      });
    });
  } catch (err) {
    const msg = `[entrypoint] unhandled_bootstrap_error: ${
      (err as Error)?.message ?? String(err)
    }`;
    try {
      fs.writeFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, {
        flag: "a",
      });
    } catch {
      // If we can't write to file, at least log to console.
    }
    // eslint-disable-next-line no-console
    console.error(msg);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}
