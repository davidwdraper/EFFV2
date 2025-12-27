// backend/services/auth/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (SvcEnvDto — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)   // (future, if auth ever goes DB-backed)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose (MOS):
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 * - Auth is a MOS (micro-orchestrator service) with **no DB**:
 *   • AppBase.checkDb = false → no NV_MONGO_* reads, no ensureIndexes() at boot.
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/app/AppBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { Registry } from "./registry/Registry";
import { buildAuthRouter } from "./routes/auth.route";

type CreateAppOptions = {
  slug: string;
  version: number;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
};

class AuthApp extends AppBase {
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
      // Auth is a MOS: no DB/indexes at boot; AppBase will skip ensureIndexes().
      checkDb: false,
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

    const r: Router = buildAuthRouter(this);
    this.app.use(base, r);
    this.log.info({ base }, "routes mounted");
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new AuthApp(opts);
  // AppBase.boot() now handles MOS vs DB behavior via checkDb.
  await app.boot();
  return { app: app.instance };
}
