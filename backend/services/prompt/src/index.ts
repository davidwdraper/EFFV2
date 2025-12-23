// backend/services/prompt/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env) [legacy concept; now DB-backed config]
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Pure orchestration entrypoint for prompt service.
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
// Service identity
// ———————————————————————————————————————————————————————————————
const SERVICE_SLUG = "prompt";
const SERVICE_VERSION = 1;
const LOG_FILE = path.resolve(process.cwd(), "prompt-startup-error.log");

(async () => {
  try {
    // Step 1: Bootstrap and load configuration (env-service-backed config)
    const { envBag, envReloader, host, port, ssb } = await envBootstrap({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      logFile: LOG_FILE,
      checkDb: true,
    });

    // Step 2: Extract the primary EnvServiceDto from the bag (first item)
    const it = (envBag as unknown as DtoBag<EnvServiceDto>).items();
    const first = it.next();
    const primary = first.done ? undefined : first.value;

    if (!primary) {
      throw new Error(
        "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No EnvServiceDto in envBag after envBootstrap. " +
          "Ops: verify env-service has a config record for this service (env@slug@version)."
      );
    }

    // Step 3: Adapt the bag-based reloader into a single-DTO reloader for AppBase/logger.
    const envReloaderForApp = async (): Promise<EnvServiceDto> => {
      const bag: DtoBag<EnvServiceDto> = (await envReloader()) as any;
      const iter = bag.items();
      const one = iter.next();
      if (!one.done && one.value) return one.value;

      throw new Error(
        "ENV_RELOADER_EMPTY_BAG: envReloader returned an empty bag. " +
          "Ops: ensure the service’s EnvServiceDto config record still exists in env-service."
      );
    };

    // Step 4: Construct and boot the service app.
    const { app } = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      envDto: primary,
      envReloader: envReloaderForApp,
      ssb,
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
      // ignore
    }
    // eslint-disable-next-line no-console
    console.error(msg);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
})();
