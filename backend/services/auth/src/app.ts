// backend/services/auth/src/app.ts
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
 * - EnvServiceDto lives ONLY inside rt (no sidecar envDto passed to AppBase).
 *
 * Test-runner invariant (virtual server):
 * - dist/app.js MUST export:
 *     - createAppBase(opts)
 *     - POSTURE
 *   so the test-runner can:
 *     1) read POSTURE to enforce posture rails in envBootstrap
 *     2) construct rt (virtual server) and call createAppBase(opts)
 */

import type { Express, Router } from "express";
import { AppBase } from "@nv/shared/base/app/AppBase";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

import { Registry } from "./registry/Registry";
import { buildAuthRouter } from "./routes/auth.route";

/**
 * Template posture for this service.
 *
 * IMPORTANT:
 * - This constant is exported so the test-runner can enforce posture-derived
 *   boot rails during envBootstrap *before* it can construct rt.
 * - Keep this in sync with src/index.ts (which should import POSTURE from here).
 */
export const POSTURE: SvcPosture = "mos";

export type CreateAppOptions = {
  slug: string;
  version: number;
  posture: SvcPosture;

  /**
   * Legacy (kept for compatibility with shared entrypoint callers).
   * Do NOT pass these into AppBase; EnvServiceDto is owned by rt.
   */
  envLabel?: string;
  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;

  /**
   * ADR-0080: REQUIRED.
   * Virtual server runtime for this service.
   */
  rt: SvcRuntime;
};

class AuthApp extends AppBase {
  private readonly registry: Registry;

  constructor(opts: CreateAppOptions) {
    // Logger is strict and must bind to SvcEnv before any log usage.
    setLoggerEnv(opts.rt.getSvcEnvDto());

    super({
      service: opts.slug,
      version: opts.version,
      posture: opts.posture,
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

    const r: Router = buildAuthRouter(this);
    this.app.use(base, r);
    this.log.info(
      { base, env: this.getEnvLabel(), posture: this.posture },
      "routes mounted"
    );
  }
}

/**
 * Dist-first target-app factory (for test-runner).
 *
 * Returns the AppBase instance so the runner can pass it into
 * pipeline createController(app) without booting a second HTTP listener.
 */
export async function createAppBase(opts: CreateAppOptions): Promise<AppBase> {
  return await AppBase.bootAppBase(() => new AuthApp(opts));
}

export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  return await AppBase.bootExpress(() => new AuthApp(opts));
}
