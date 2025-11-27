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

const SERVICE_SLUG = "env-service";
const SERVICE_VERSION = 1;

(async () => {
  try {
    const { envBag, envReloader, host, port } = await envBootstrap({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
    });

    // For now envBootstrap doesn’t return envName; if you want, you can derive it
    // the same way envBootstrap does internally:
    const envName = (process.env.NV_ENV ?? "dev").trim() || "dev";

    const { app } = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      envName,
      envDto: (() => {
        let primary;
        for (const dto of envBag as any as Iterable<any>) {
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
      })(),
      envReloader: async () => {
        const bag = await envReloader();
        for (const dto of bag as any as Iterable<any>) {
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
        env: envName,
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
