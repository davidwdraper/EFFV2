// backend/services/env-service/src/bootstrap/envBootstrap.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version@level)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *
 * Purpose:
 * - Bootstrap env-service without svcenvClient or SvcEnvDto.
 * - Read DB connection details from process.env (.env file).
 * - Use DbReader + EnvConfigReader to load this service's EnvServiceDto config.
 * - Return:
 *     • envBag: DtoBag<EnvServiceDto>
 *     • envReloader: () => Promise<DtoBag<EnvServiceDto>>
 *     • host/port: derived from vars in the bag.
 *
 * Rules:
 * - No naked DTOs cross this boundary: always a DtoBag in/out.
 * - Only console + filesystem logging until shared logger is up.
 * - Canonical DB keys for ALL services (including env-service) are:
 *     • NV_MONGO_URI
 *     • NV_MONGO_DB
 */

import fs from "fs";
import path from "path";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import { DbReader } from "@nv/shared/dto/persistence/DbReader";
import { EnvConfigReader } from "../svc/EnvConfigReader";

type BootstrapOpts = {
  slug: string;
  version: number;
  logFile?: string;
};

export type EnvBootstrapResult = {
  envBag: DtoBag<EnvServiceDto>;
  envReloader: () => Promise<DtoBag<EnvServiceDto>>;
  host: string;
  port: number;
};

/** Resolve log file path (default to service root file). */
function resolveLogFile(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  return path.resolve(process.cwd(), "env-service-startup-error.log");
}

/** Log a fatal bootstrap error to console + file, then exit. */
function fatal(logFile: string, message: string, err?: unknown): never {
  const text = `[${new Date().toISOString()}] ${message}${
    err ? ` — ${(err as Error)?.message ?? String(err)}` : ""
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

/** Require an env var, log to file on failure, and exit. */
function requireEnv(name: string, logFile: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    fatal(
      logFile,
      `BOOTSTRAP_ENV_MISSING: Required env "${name}" is not set. ` +
        "Ops: add this key to the appropriate .env file for env-service and restart."
    );
  }
  return v.trim();
}

/**
 * Bootstrap env-service:
 * - Reads DB config from env (NV_MONGO_URI / NV_MONGO_DB).
 * - Uses DbReader + EnvConfigReader to fetch its own EnvServiceDto config as a DtoBag.
 * - Derives HTTP host/port from the DTO inside the bag (internally).
 * - Returns:
 *     • envBag
 *     • envReloader (returns DtoBag)
 *     • host/port
 */
export async function envBootstrap(
  opts: BootstrapOpts
): Promise<EnvBootstrapResult> {
  const logFile = resolveLogFile(opts.logFile);
  const { slug, version } = opts;

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap starting", { slug, version });

  // 1) Required DB config from env (.env file)
  // Canonical names for ALL services (including env-service)
  const mongoUri = requireEnv("NV_MONGO_URI", logFile);
  const mongoDb = requireEnv("NV_MONGO_DB", logFile);

  // 2) Initialize DbReader and EnvConfigReader (shared with controllers/handlers)
  let dbReader: DbReader<EnvServiceDto>;
  try {
    dbReader = new DbReader<EnvServiceDto>({
      dtoCtor: EnvServiceDto,
      mongoUri,
      mongoDb,
    });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_DBREADER_INIT_FAILED: Failed to construct DbReader. " +
        "Ops: verify NV_MONGO_URI/NV_MONGO_DB configuration for env-service.",
      err
    );
  }

  const configReader = new EnvConfigReader(dbReader);

  // 3) Determine current logical environment (default "dev")
  const envName = (process.env.NV_ENV ?? "dev").trim() || "dev";
  const level = "service";

  // 4) Load config bag via shared reader (no naked DTOs)
  let envBag: DtoBag<EnvServiceDto>;
  try {
    envBag = await configReader.getConfigBag({
      env: envName,
      slug,
      version,
      level,
    });
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_CONFIG_FAILED: Failed to load env-service configuration " +
        `for env="${envName}", slug="${slug}", version=${version}, level="${level}". ` +
        "Ops: insert this document into the env-service collection and retry.",
      err
    );
  }

  // 5) Derive listener host/port from the *first* DTO in the bag (internal only).
  let primary: EnvServiceDto | undefined;
  for (const dto of envBag as unknown as Iterable<EnvServiceDto>) {
    primary = dto;
    break;
  }

  if (!primary) {
    fatal(
      logFile,
      "BOOTSTRAP_ENV_BAG_EMPTY: EnvServiceDto bag was empty after successful read. " +
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
          "Ops: fix this value in the env-service config document."
      );
    }
    port = Math.trunc(n);
  } catch (err) {
    fatal(
      logFile,
      "BOOTSTRAP_HTTP_CONFIG_INVALID: Failed to derive NV_HTTP_HOST/NV_HTTP_PORT " +
        "from env-service configuration. Ops: ensure these keys exist and are valid.",
      err
    );
  }

  // 6) DtoBag-based reloader: same reader, same logic, fresh bag.
  const envReloader = async (): Promise<DtoBag<EnvServiceDto>> => {
    const nextEnvName = (process.env.NV_ENV ?? envName).trim() || envName;
    return configReader.getConfigBag({
      env: nextEnvName,
      slug,
      version,
      level,
    });
  };

  // eslint-disable-next-line no-console
  console.log("[bootstrap] envBootstrap complete", { host, port });

  return {
    envBag,
    envReloader,
    host,
    port,
  };
}
