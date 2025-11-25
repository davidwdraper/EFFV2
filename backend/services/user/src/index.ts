// backend/services/user/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env) [legacy concept; now DB-backed config]
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *
 * Purpose (template):
 * - Pure orchestration entrypoint for a CRUD-style service cloned from user.
 * - Delegates DB + config loading to envBootstrap().
 * - Unwraps the EnvServiceDto (from envBag) for createApp().
 */

import fs from "fs";
import path from "path";
import createApp from "./app";
import { envBootstrap } from "@nv/shared/bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";

// ———————————————————————————————————————————————————————————————
// Service identity (template — overridden by clone slug/name)
// ———————————————————————————————————————————————————————————————
const SERVICE_SLUG = "user";
const SERVICE_VERSION = 1;
const LOG_FILE = path.resolve(process.cwd(), "user-startup-error.log");

(async () => {
  try {
    // Step 1: Bootstrap and load configuration (env-service-backed config)
    const { envBag, envReloader, host, port } = await envBootstrap({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      logFile: LOG_FILE,
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
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
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
