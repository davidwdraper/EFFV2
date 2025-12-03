// backend/services/env-service/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *
 * Purpose:
 * - Dedicated entrypoint for env-service.
 * - Uses env-service-specific bootstrap that reads DB config from process.env
 *   and loads EnvServiceDto via DbReader, not via SvcClient.
 */

import createApp from "./app";
import { envBootstrap } from "./bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

const SERVICE_SLUG = "env-service";
const SERVICE_VERSION = 1;

(async () => {
  try {
    const { envBag, envReloader, host, port } = await envBootstrap({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
    });

    // Select the primary EnvServiceDto from the merged bag.
    const envDto: EnvServiceDto = (() => {
      let primary: EnvServiceDto | undefined;
      for (const dto of envBag as unknown as Iterable<EnvServiceDto>) {
        primary = dto;
        break;
      }
      if (!primary) {
        throw new Error(
          "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No EnvServiceDto returned " +
            "from envBootstrap for env-service."
        );
      }
      return primary;
    })();

    const envLabel = envDto.getEnvLabel();

    const { app } = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      envLabel,
      envDto,
      envReloader: async () => {
        const bag = await envReloader();
        for (const dto of bag as unknown as Iterable<EnvServiceDto>) {
          return dto;
        }
        throw new Error(
          "ENV_RELOADER_EMPTY_BAG: envReloader returned an empty bag for env-service."
        );
      },
    });

    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.info("[entrypoint] http_listening", {
        slug: SERVICE_SLUG,
        version: SERVICE_VERSION,
        envLabel,
        host,
        port,
      });
    });
  } catch (err) {
    const msg = `[entrypoint] unhandled_bootstrap_error: ${
      (err as Error)?.message ?? String(err)
    }`;
    // env-service’s own bootstrap already writes to its log file; this console
    // log is just a last resort.
    // eslint-disable-next-line no-console
    console.error(msg);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
})();
