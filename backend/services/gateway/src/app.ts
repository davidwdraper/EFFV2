// backend/services/gateway/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0045 (Index Hints — boot ensure via shared helper)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Owns the concrete per-service Registry and exposes it via AppBase.getDtoRegistry().
 * - For gateway, DB/index ensure is ON (checkDb=true).
 *
 * Notes:
 * - Health + env reload remain versioned under `/api/gateway/v1/*` (AppBase).
 * - All proxied traffic is mounted under `/api` and handled by the proxy controller.
 */

import type { Express, Router } from "express";
import express = require("express");
import { AppBase } from "@nv/shared/base/app/AppBase";
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { setLoggerEnv } from "@nv/shared/logger/Logger";

import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";
import { Registry } from "./registry/Registry";
import { buildGatewayRouter } from "./routes/gateway.route";

type CreateAppOptions = {
  slug: string;
  version: number;

  /**
   * Logical environment label for this process (e.g., "dev", "stage", "prod").
   * - Passed through from envBootstrap.getEnvLabel().
   * - Any SvcClient created inside this service should use this value.
   */
  envLabel: string;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;
};

class gatewayApp extends AppBase {
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
      // gateway is DB-backed: requires NV_MONGO_* and index ensure at boot.
      checkDb: true,
    });

    // AppBase now sources envLabel from envDto; no need to pass it directly.
    this.registry = new Registry();
  }

  /** ADR-0049: Base-typed accessor so handlers/controllers stay decoupled. */
  public override getDtoRegistry(): IDtoRegistry {
    return this.registry;
  }

  /**
   * Mount service routes.
   *
   * Health + env reload are mounted by AppBase under:
   *   /api/gateway/v<version>/health
   *   /api/gateway/v<version>/env/reload
   *
   * All proxied traffic uses the shared gateway router under `/api`.
   */
  protected override mountRoutes(): void {
    const base = "/api";
    const r: Router = buildGatewayRouter(this);
    this.app.use(base, r);
    this.log.info(
      { base, envLabel: this.getEnvLabel() },
      "gateway proxy routes mounted"
    );
  }
}

/** Public factory: constructs, boots, and returns the Express instance holder. */
export default async function createApp(
  opts: CreateAppOptions
): Promise<{ app: Express }> {
  const app = new gatewayApp(opts);
  // AppBase handles registry diagnostics + ensureIndexes (checkDb=true)
  await app.boot();
  return { app: app.instance };
}
