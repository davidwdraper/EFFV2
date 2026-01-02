// backend/services/shared/src/bootstrap/ServiceEntrypoint.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0074 (DB_STATE guardrail, getDbVar, and `_infra` DBs)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Shared async entrypoint helper for HTTP services.
 * - Owns envBootstrap + EnvServiceDto selection + reloader adaptation +
 *   createApp() + listen() + fatal error handling.
 *
 * Notes:
 * - env-service is the exception: it uses its own local bootstrap and does NOT
 *   use this entrypoint.
 *
 * Invariants:
 * - Posture is REQUIRED and is the single source of truth for boot rails (ADR-0084).
 * - Entrypoint must not pass/own checkDb (derived by AppBase from posture).
 * - envBootstrap constructs SvcRuntime once and returns it.
 */

import fs from "fs";
import path from "path";
import { envBootstrap } from "./envBootstrap";
import { EnvServiceDto } from "../dto/env-service.dto";
import type { DtoBag } from "../dto/DtoBag";
import type { SvcRuntime } from "../runtime/SvcRuntime";
import type { SvcPosture } from "../runtime/SvcPosture";

export interface ServiceEntrypointOptions {
  slug: string;
  version: number;

  /**
   * ADR-0084: REQUIRED.
   * Declares the service posture (mos, db, api, fs, stream, etc.).
   * Boot rails derive from this posture (AppBase derives checkDb).
   */
  posture: SvcPosture;

  /**
   * Optional override for the startup error log filename.
   * Defaults to "<slug>-startup-error.log" in process.cwd().
   */
  logFileBasename?: string;

  /**
   * Service-specific app factory.
   *
   * Invariants:
   * - SvcRuntime is mandatory and MUST be injected.
   * - posture is mandatory and MUST be passed through to AppBase.
   * - envLabel is convenience only; AppBase must source envLabel from rt.
   */
  createApp: (opts: {
    slug: string;
    version: number;
    posture: SvcPosture;
    envLabel: string;
    envDto: EnvServiceDto;
    envReloader: () => Promise<EnvServiceDto>;
    rt: SvcRuntime;
  }) => Promise<{
    app: {
      listen: (port: number, host: string, cb: () => void) => void;
    };
  }>;
}

export async function runServiceEntrypoint(
  opts: ServiceEntrypointOptions
): Promise<void> {
  const { slug, version, posture, createApp } = opts;
  const logFileBasename = opts.logFileBasename ?? `${slug}-startup-error.log`;
  const logFile = path.resolve(process.cwd(), logFileBasename);

  try {
    // Step 1: Bootstrap and load configuration + runtime.
    // ADR-0084: posture is required; no checkDb flag exists here.
    const { envLabel, envBag, envReloader, host, port, rt } =
      await envBootstrap({
        slug,
        version,
        posture,
        logFile,
      });

    // Step 2: Extract primary EnvServiceDto (first item, deterministic).
    const it = (envBag as unknown as DtoBag<EnvServiceDto>).items();
    const first = it.next();
    const primary: EnvServiceDto | undefined = first.done
      ? undefined
      : first.value;

    if (!primary) {
      throw new Error(
        "BOOTSTRAP_ENV_BAG_EMPTY_AT_ENTRYPOINT: No EnvServiceDto in envBag after envBootstrap. " +
          "Ops: verify env-service has a config record for this service (env@slug@version)."
      );
    }

    // Step 3: Adapt bag reloader to single-DTO reloader.
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
      slug,
      version,
      posture,
      envLabel, // convenience only; AppBase must source env from rt
      envDto: primary,
      envReloader: envReloaderForApp,
      rt,
    });

    // Step 5: Listen.
    app.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.info("[entrypoint] http_listening", {
        slug,
        version,
        posture,
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
      // ignore
    }
    // eslint-disable-next-line no-console
    console.error(msg);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}
