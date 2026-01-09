// backend/services/env-service/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 * - For env-service, DB/index ensure is ON (DB posture).
 *
 * Invariants:
 * - env-service is the first “pure” SvcRuntime service: rt is REQUIRED here.
 * - posture is REQUIRED by AppBaseCtor and must be provided by the entrypoint.
 * - AppBaseCtor does NOT accept envDto/envReloader; DbEnvServiceDto lives inside rt only.
 * - env-service env reload must be DB-backed (NOT S2S to itself).
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/app/AppBase";
import type { AppBaseCtor } from "@nv/shared/base/app/AppBase";
import { setLoggerEnv } from "@nv/shared/logger/Logger";
import type { DbEnvServiceDto } from "@nv/shared/dto/db.env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/IDtoRegistry";
import { DtoRegistry } from "@nv/shared/registry/DtoRegistry";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

import { buildEnvServiceRouter } from "./routes/env-service.route";

// AppBase.ts defines SvcPosture but does not export it.
// We derive the public posture type from the exported ctor contract instead.
type SvcPosture = AppBaseCtor["posture"];

type CreateAppOptions = {
  slug: string;
  version: number;

  /**
   * ADR-0084: rail posture (required by AppBaseCtor).
   * Caller (index.ts) supplies the correct constant; no literals here.
   */
  posture: SvcPosture;

  /**
   * ADR-0080: canonical runtime container (mandatory for env-service).
   * rt owns DbEnvServiceDto and envLabel.
   */
  rt: SvcRuntime;

  /**
   * DB-backed env reload (env-service special-case).
   * Must update rt only; never leak DTO sidecars.
   */
  envReloader: () => Promise<DbEnvServiceDto>;
};

class EnvServiceApp extends AppBase {
  /**
   * Concrete registry instance.
   *
   * IMPORTANT:
   * - Do NOT name this field "registry" because AppBase already has a private "registry"
   *   (private members are nominal; same name => type incompatibility).
   */
  private readonly dtoRegistry: DtoRegistry;

  constructor(private readonly opts: CreateAppOptions) {
    // Logger is strict and requires SvcEnv; rt already owns the merged DbEnvServiceDto.
    setLoggerEnv(opts.rt.getSvcEnvDto());

    super({
      service: opts.slug,
      version: opts.version,
      posture: opts.posture,
      rt: opts.rt,
    });

    // Use the shared registry for now; it already implements IDtoRegistry.create().
    this.dtoRegistry = new DtoRegistry();

    this.log.info(
      {
        appEnvLabel: this.getEnvLabel(),
        posture: opts.posture,
        rt: opts.rt.describe(),
      },
      "env-service app constructed"
    );
  }

  // adr0082-infra-service-health-boot-check
  // Ensure that infra health checking does not run for env-service.
  public override isInfraService(): boolean {
    return true;
  }

  /** ADR-0049: Base-typed accessor so handlers/controllers stay decoupled. */
  public override getDtoRegistry(): IDtoRegistry {
    return this.dtoRegistry;
  }

  /**
   * env-service special-case: env reload is DB-backed, not S2S.
   * This overrides the default AppBase wiring which uses SvcEnvClient (S2S).
   */
  protected override wireEnvReloadCap(): void {
    const rt = this.getRuntime();
    rt.setCapFactory("env.reloader", async (rt) => {
      const fresh = await this.opts.envReloader();
      rt.setEnvDto(fresh);
      return fresh;
    });

    this.log.info(
      {
        event: "rt_cap_factory_wired",
        capKey: "env.reloader",
        service: this.service,
        version: this.version,
      },
      "wired runtime cap factory"
    );
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

    this.log.info({ base, envLabel: this.getEnvLabel() }, "routes mounted");
  }
}

/**
 * Dist-first target-app factory (for test-runner).
 *
 * Returns the AppBase instance so the runner can pass it into
 * pipeline createController(app) without booting a second HTTP listener.
 */
export async function createAppBase(opts: CreateAppOptions): Promise<AppBase> {
  return await AppBase.bootAppBase(() => new EnvServiceApp(opts));
}

export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  return await AppBase.bootExpress(() => new EnvServiceApp(opts));
}
