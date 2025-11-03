// backend/services/t_entity_crud/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose (template):
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Delegates heavy lifting to AppBase; mounts service routes as one-liners.
 * - Owns the concrete DtoRegistry and exposes it to routers/controllers.
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/AppBase";
import { SvcEnvDto } from "@nv/shared/dto/svcenv.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";
import { BaseDto } from "@nv/shared/dto/DtoBase";

import { buildXxxRouter } from "./routes/xxx.route";
import { Registry } from "./registry/Registry";

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
    // Logger first so instrumentation is stable.
    setLoggerEnv(opts.envDto);

    // Wire DTO env ONCE before any DTO static calls (indexes/readers/writers).
    BaseDto.configureEnv(opts.envDto);

    super({
      service: opts.slug,
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
    });

    // Per-service registry is constructed at boot and retained on the app instance.
    this.registry = new Registry();
  }

  /** Accessor so routers/controllers can retrieve the DtoRegistry. */
  public getDtoRegistry(): Registry {
    return this.registry;
  }

  /** Boot-time: delegate deterministic index ensure to the Registry. */
  protected override async onBoot(): Promise<void> {
    await this.registry.ensureIndexes({
      svcEnv: this.svcEnv, // ADR-0044 accessor
      log: this.log,
    });
  }

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

export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new XxxApp(opts);
  await app.boot();
  return { app: app.instance };
}
