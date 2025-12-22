// backend/services/env-service/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0074 (DB_STATE-aware DB selection; _infra state-invariant bootstrap DBs)
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Dedicated entrypoint for env-service.
 * - Uses env-service-specific bootstrap that reads DB config from process.env
 *   and loads EnvServiceDto via DbReader, not via SvcClient.
 *
 * Invariants:
 * - After envBootstrap(), runtime must not read process.env.
 * - SvcSandbox is mandatory for env-service runtime.
 */

import createApp from "./app";
import { envBootstrap } from "./bootstrap/envBootstrap";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { SvcSandbox } from "@nv/shared/sandbox/SvcSandbox";

const SERVICE_SLUG = "env-service";
const SERVICE_VERSION = 1;

type BootLog = {
  debug: (o: any, m: string) => void;
  info: (o: any, m: string) => void;
  warn: (o: any, m: string) => void;
  error: (o: any, m: string) => void;
};

function bootLogger(): BootLog {
  const write = (
    level: "debug" | "info" | "warn" | "error",
    o: any,
    m: string
  ) =>
    // eslint-disable-next-line no-console
    console[level](`[entrypoint] ${m}`, o);

  return {
    debug: (o, m) => write("debug", o, m),
    info: (o, m) => write("info", o, m),
    warn: (o, m) => write("warn", o, m),
    error: (o, m) => write("error", o, m),
  };
}

function firstDtoFromBag(bag: unknown): EnvServiceDto {
  for (const dto of bag as unknown as Iterable<EnvServiceDto>) {
    return dto;
  }
  throw new Error(
    "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No EnvServiceDto returned from envBootstrap for env-service."
  );
}

function mergeVarsFromBag(bag: unknown): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const dto of bag as unknown as Iterable<EnvServiceDto>) {
    // Requires EnvServiceDto.getVarsRaw() (defensive copy).
    const vars = dto.getVarsRaw();
    for (const [k, v] of Object.entries(vars)) {
      const key = (k ?? "").trim();
      if (!key) continue;
      merged[key] = String(v ?? "");
    }
  }
  return merged;
}

(async () => {
  try {
    const { envBag, envReloader, host, port } = await envBootstrap({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
    });

    const primary = firstDtoFromBag(envBag);
    const envLabel = primary.getEnvLabel();

    // Build merged vars from the merged root+service bag.
    const vars = mergeVarsFromBag(envBag);

    const dbState = (vars["DB_STATE"] ?? "").trim();
    if (!dbState) {
      throw new Error(
        `BOOTSTRAP_DBSTATE_MISSING: DB_STATE is required for env="${envLabel}", slug="${SERVICE_SLUG}", version=${SERVICE_VERSION}. ` +
          'Ops: set "DB_STATE" in the env-service config record(s) (root and/or service) for this env.'
      );
    }

    // SvcSandbox is the canonical runtime owner (ADR-0080).
    // Logger is a minimal boot logger until the shared logger is fully up inside AppBase.
    const ssb = new SvcSandbox(
      {
        serviceSlug: SERVICE_SLUG,
        serviceVersion: SERVICE_VERSION,
        env: envLabel,
        dbState,
      },
      vars,
      bootLogger() as any
    );

    const { app } = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      envLabel,
      envDto: primary,
      envReloader: async () => firstDtoFromBag(await envReloader()),
      ssb,
    });

    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.info("[entrypoint] http_listening", {
        slug: SERVICE_SLUG,
        version: SERVICE_VERSION,
        envLabel,
        host,
        port,
        ssb: ssb.describe(),
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
