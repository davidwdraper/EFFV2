// backend/services/env-service/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (DbEnvServiceDto — one doc per env@slug@version)
 *   - ADR-0074 (DB_STATE-aware DB selection; _infra state-invariant bootstrap DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Dedicated entrypoint for env-service.
 * - Uses env-service-specific bootstrap that reads DB config from process.env
 *   and loads DbEnvServiceDto via DbReader, not via SvcClient.
 *
 * Invariants:
 * - After envBootstrap(), runtime must not read process.env.
 * - SvcRuntime is mandatory for env-service runtime.
 * - Posture is declared explicitly here (no AppBase “constants” imports).
 *
 * Posture truth:
 * - env-service is a DB posture service (CRUD over Mongo).
 * - “infra” is NOT a posture; it’s a role/boot-rail dependency.
 */

import createApp from "./app";
import { envBootstrap } from "./bootstrap/envBootstrap";
import { DbEnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";

const SERVICE_SLUG = "env-service";
const SERVICE_VERSION = 1;

// env-service is a DB posture (dumb CRUD over Mongo).
const POSTURE: SvcPosture = "db";

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

function firstDtoFromBag(bag: unknown): DbEnvServiceDto {
  for (const dto of bag as unknown as Iterable<DbEnvServiceDto>) {
    return dto;
  }
  throw new Error(
    "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No DbEnvServiceDto returned from envBootstrap for env-service."
  );
}

function mergeVarsFromBag(bag: unknown): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const dto of bag as unknown as Iterable<DbEnvServiceDto>) {
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

    // NOTE:
    // SvcRuntime requires dbState at construction time; we compute it from the
    // bootstrap bag’s merged vars, but runtime remains DTO-backed (no vars map cache).
    const mergedVars = mergeVarsFromBag(envBag);

    const dbState = (mergedVars["DB_STATE"] ?? "").trim();
    if (!dbState) {
      throw new Error(
        `BOOTSTRAP_DBSTATE_MISSING: DB_STATE is required for env="${envLabel}", slug="${SERVICE_SLUG}", version=${SERVICE_VERSION}. ` +
          'Ops: set "DB_STATE" in the env-service config record(s) (root and/or service) for this env.'
      );
    }

    const rt = new SvcRuntime(
      {
        serviceSlug: SERVICE_SLUG,
        serviceVersion: SERVICE_VERSION,
        env: envLabel,
        dbState,
      },
      primary,
      bootLogger() as any
    );

    const { app } = await createApp({
      slug: SERVICE_SLUG,
      version: SERVICE_VERSION,
      posture: POSTURE,
      rt,
      envReloader: async () => firstDtoFromBag(await envReloader()),
    });

    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.info("[entrypoint] http_listening", {
        slug: SERVICE_SLUG,
        version: SERVICE_VERSION,
        envLabel,
        host,
        port,
        posture: POSTURE,
        rt: rt.describe(),
      });
    });
  } catch (err) {
    const msg = `[entrypoint] unhandled_bootstrap_error: ${
      (err as Error)?.message ?? String(err)
    }`;
    // eslint-disable-next-line no-console
    console.error(msg);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
})();
