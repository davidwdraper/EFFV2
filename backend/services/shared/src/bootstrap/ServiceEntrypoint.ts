// backend/services/shared/src/bootstrap/ServiceEntrypoint.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *
 * Purpose:
 * - Shared async entrypoint helper for HTTP services.
 * - Owns envBootstrap + EnvServiceDto selection + reloader adaptation +
 *   listen() + fatal error handling.
 *
 * Notes:
 * - All CRUD-style and infra services (env-service, svcconfig, gateway, etc.)
 *   should use this instead of duplicating index.ts logic.
 */

import fs from "fs";
import path from "path";
import { envBootstrap } from "@nv/shared/bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";

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
   */
  createApp: (opts: {
    slug: string;
    version: number;
    envName: string;
    envDto: EnvServiceDto;
    envReloader: () => Promise<EnvServiceDto>;
  }) => Promise<{
    app: {
      listen: (port: number, host: string, cb: () => void) => void;
    };
  }>;
}

export async function runServiceEntrypoint(
  opts: ServiceEntrypointOptions
): Promise<void> {
  const { slug, version, createApp, checkDb = true } = opts;
  const logFileBasename = opts.logFileBasename ?? `${slug}-startup-error.log`;
  const logFile = path.resolve(process.cwd(), logFileBasename);

  try {
    // Step 1: Bootstrap and load configuration (env-service-backed config)
    const { envName, envBag, envReloader, host, port } = await envBootstrap({
      slug,
      version,
      logFile,
      checkDb,
    });

    // Step 2: Extract the primary EnvServiceDto from the bag (should always be exactly one)
    let primary: EnvServiceDto | undefined;
    for (const dto of envBag as unknown as Iterable<EnvServiceDto>) {
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

    // Step 3: Adapt the bag-based reloader into a single-DTO reloader for the AppBase/logger.
    const envReloaderForApp = async (): Promise<EnvServiceDto> => {
      const bag: DtoBag<EnvServiceDto> = await envReloader();
      for (const dto of bag as unknown as Iterable<EnvServiceDto>) {
        return dto;
      }
      throw new Error(
        "ENV_RELOADER_EMPTY_BAG: envReloader returned an empty bag. " +
          "Ops: ensure the service’s EnvServiceDto config record still exists in env-service " +
          "and matches (env, slug, version, level) expected by envBootstrap."
      );
    };

    // Step 4: Construct and boot the service app.
    const { app } = await createApp({
      slug,
      version,
      envName, // logical env for this process ("dev", "stage", "prod")
      envDto: primary,
      envReloader: envReloaderForApp,
    });

    // Step 5: Start listening.
    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.info("[entrypoint] http_listening", {
        slug,
        version,
        env: envName,
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
