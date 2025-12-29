// backend/services/handler-test/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 *
 * Invariants:
 * - Posture is the single source of truth (no checkDb duplication).
 * - SvcRuntime is REQUIRED: AppBase ctor must receive rt.
 * - Runtime caps are wired ONLY in AppBase (single source of truth).
 */

import type { Express, Router } from "express";
import { AppBase } from "@nv/shared/base/app/AppBase";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";

import { Registry } from "./registry/Registry";
import { buildHandlerTestRouter } from "./routes/handler-test.route";

export type CreateAppOptions = {
  slug: string;
  version: number;
  posture: SvcPosture;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;

  rt: SvcRuntime;
};

class HandlerTestApp extends AppBase {
  private readonly registry: Registry;

  constructor(opts: CreateAppOptions) {
    super({
      service: opts.slug,
      version: opts.version,
      posture: opts.posture,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
      rt: opts.rt,
    });

    this.registry = new Registry();
  }

  public override getDtoRegistry(): IDtoRegistry {
    return this.registry;
  }

  protected override mountRoutes(): void {
    const base = this.healthBasePath(); // `/api/<slug>/v<version>`
    if (!base) {
      this.log.error({ reason: "no_base" }, "Failed to derive base path");
      throw new Error("Base path missing — check AppBase.healthBasePath()");
    }

    const r: Router = buildHandlerTestRouter(this);
    this.app.use(base, r);
    this.log.info(
      { base, env: this.getEnvLabel(), posture: this.posture },
      "routes mounted"
    );
  }
}

export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new HandlerTestApp(opts);
  await app.boot();
  return { app: app.instance };
}
