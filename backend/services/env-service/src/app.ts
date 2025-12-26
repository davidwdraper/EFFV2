// backend/services/env-service/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 * - For env-service, DB/index ensure is ON (checkDb=true).
 *
 * Invariants:
 * - env-service is the first “pure” SvcRuntime service: rt is REQUIRED here.
 * - Commit 2: envLabel is authoritative from rt (AppBase.getEnvLabel()).
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/app/AppBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { Registry } from "./registry/Registry";
import { buildEnvServiceRouter } from "./routes/env-service.route";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

type CreateAppOptions = {
  slug: string;
  version: number;

  /**
   * Environment label for this running instance (e.g., "dev", "staging", "prod").
   * Retained for diagnostics only; AppBase env label is sourced from rt.
   */
  envLabel: string;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;

  /**
   * ADR-0080: canonical runtime container (mandatory for env-service).
   */
  rt: SvcRuntime;
};

class EnvServiceApp extends AppBase {
  /** Concrete per-service DTO registry (explicit, no barrels). */
  private readonly registry: Registry;

  constructor(opts: CreateAppOptions) {
    // Initialize logger first so all subsequent boot logs have proper context.
    setLoggerEnv(opts.envDto);

    super({
      service: opts.slug,
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
      // env-service is DB-backed: requires NV_MONGO_* and index ensure at boot.
      checkDb: true,

      // ADR-0080: env-service MUST run with rt.
      rt: opts.rt,
    });

    this.registry = new Registry();

    // Optional: log the envLabel explicitly so operators get visibility
    this.log.info(
      {
        declaredEnvLabel: opts.envLabel,
        appEnvLabel: this.getEnvLabel(), // now sourced from rt
        rt: opts.rt.describe(),
      },
      "env-service app constructed"
    );
  }

  // adr0082-infra-service-health-boot-check
  // Endure that infra health checking does not run for env-service.
  public override isInfraService(): boolean {
    return true;
  }

  /** ADR-0049: Base-typed accessor so handlers/controllers stay decoupled. */
  public override getDtoRegistry(): IDtoRegistry {
    return this.registry;
  }

  /** Mount service routes as one-liners under the versioned base. */
  protected override mountRoutes(): void {
    const base = this.healthBasePath(); // `/api/<slug>/v<version>`
    if (!base) {
      this.log.error({ reason: "no_base" }, "Failed to derive base path");
      throw new Error("Base path missing — check AppBase.healthBasePath()");
    }

    const r: Router = buildEnvServiceRouter(this);
    this.app.use(base, r);
    this.log.info(
      { base, envLabel: this.getEnvLabel() },
      "env-service routes mounted"
    );
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new EnvServiceApp(opts);
  await app.boot(); // AppBase handles registry diagnostics + ensureIndexes (checkDb=true)
  return { app: app.instance };
}
