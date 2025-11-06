// backend/services/t_entity_crud/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose (template):
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 * - Ensures Mongo indexes are created at boot (before any routes are mounted).
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/AppBase";
import { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { Registry } from "./registry/Registry";
import { buildXxxRouter } from "./routes/xxx.route";

type CreateAppOptions = {
  slug: string;
  version: number;
  envDto: SvcEnvDto;
  envReloader: () => Promise<SvcEnvDto>;
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
    });

    this.registry = new Registry();
  }

  /** ADR-0049: Base-typed accessor so controllers/handlers stay decoupled. */
  public override getDtoRegistry(): IDtoRegistry {
    return this.registry;
  }

  /**
   * Boot sequence (awaited by AppBase.boot()):
   * 1) Ensure indexes for all registered DTO classes via Registry (single source of truth).
   *    Must complete before routes mount.
   */
  protected override async onBoot(): Promise<void> {
    // Deterministic index creation using DTO-declared indexHints.
    await this.registry.ensureIndexes(this.svcEnv, this.log);
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
    this.log.info({ base }, "routes mounted");
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new XxxApp(opts);
  await app.boot(); // ensures onBoot (indexes) completes BEFORE routes mount/serve
  return { app: app.instance };
}
