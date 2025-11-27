// backend/services/env-service/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env) [legacy concept; now DB-backed config]
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *
 * Purpose:
 * - Pure orchestration entrypoint for env-service.
 * - Delegates DB + config loading to envBootstrap().
 * - Unwraps the merged EnvServiceDto (from envBag) for createApp().
 */

import fs from "fs";
import path from "path";
import createApp from "./app";
import { envBootstrap } from "./bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";

const SERVICE_SLUG = "env-service";
const SERVICE_VERSION = 1;
const LOG_FILE = path.resolve(process.cwd(), "env-service-startup-error.log");

(async () => {
  try {
    // Determine the concrete environment name for this process (e.g., "dev", "staging", "prod").
    const envName = process.env.NV_ENV;
    if (!envName) {
      throw new Error(
        "ENV_NAME_MISSING: NV_ENV is not set for env-service. " +
          "Ops: ensure NV_ENV is configured for this process (e.g., dev/staging/prod) " +
          "before starting env-service."
      );
    }

    // Step 1: Bootstrap and load configuration (merged root + service config)
    const { envBag, envReloader, host, port } = await envBootstrap({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      logFile: LOG_FILE,
    });

    // Step 2: Extract the primary DTO from the bag (should always be exactly one)
    let primary: EnvServiceDto | undefined;
    for (const dto of envBag as unknown as Iterable<EnvServiceDto>) {
      primary = dto;
      break;
    }

    if (!primary) {
      throw new Error(
        "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No EnvServiceDto in envBag after envBootstrap. " +
          "Ops: inspect env-service collection for env-service’s own record."
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
          "Ops: ensure env-service config record still exists and matches (env, slug, version, level)."
      );
    };

    // Step 4: Construct and boot the service app.
    const { app } = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      envName,
      envDto: primary,
      envReloader: envReloaderForApp,
    });

    // Step 5: Start listening.
    app.listen(port, host, () => {
      console.info("[entrypoint] http_listening", {
        slug: SERVICE_SLUG,
        version: SERVICE_VERSION,
        host,
        port,
        envName,
      });
    });
  } catch (err) {
    const msg = `[entrypoint] unhandled_bootstrap_error: ${
      (err as Error)?.message ?? String(err)
    }`;
    try {
      fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, {
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
})();
