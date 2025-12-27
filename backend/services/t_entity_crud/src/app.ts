// backend/services/xxx/src/app.ts
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
 * - DB-backed service: requires NV_MONGO_* and index ensure at boot (checkDb=true).
 *
 * Invariants:
 * - SvcRuntime is REQUIRED: AppBase ctor must receive rt.
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/app/AppBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

import { Registry } from "./registry/Registry";
import { buildXxxRouter } from "./routes/xxx.route";

type CreateAppOptions = {
  slug: string;
  version: number;
  /**
   * Logical environment label for this process (e.g., "dev", "stage", "prod").
   * - Passed through from envBootstrap.envLabel.
   */
  envLabel: string;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
  /**
   * SvcRuntime is mandatory (ADR-0080).
   * Constructed by envBootstrap() after envDto is available.
   */
  rt: SvcRuntime;
};

class XxxApp extends AppBase {
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
      // xxx is DB-backed: needs NV_MONGO_* and ensureIndexes at boot.
      checkDb: true,
      // REQUIRED by AppBaseCtor: xxx is a SvcRuntime service.
      rt: opts.rt,
    });

    this.registry = new Registry();
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

    const r: Router = buildXxxRouter(this);
    this.app.use(base, r);
    this.log.info({ base, env: this.getEnvLabel() }, "routes mounted");
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new XxxApp(opts);
  // AppBase handles registry diagnostics + ensureIndexes (checkDb=true)
  await app.boot();
  return { app: app.instance };
}
