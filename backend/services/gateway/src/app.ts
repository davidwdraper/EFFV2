// backend/services/gateway/src/app.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0039 (svcenv centralized non-secret env; runtime reload endpoint)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-#### (AppBase Optional DTO Registry for Proxy Services)
 *
 * Purpose:
 * - Orchestration-only app. Defines order; no business logic or helpers here.
 * - Gateway is a pure proxy: NO registry, NO DB/index ensure.
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
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

import { buildGatewayRouter } from "./routes/gateway.route";

type CreateAppOptions = {
  slug: string;
  version: number;

  /**
   * Convenience only; AppBase must source env label from rt (ADR-0080 Commit 2).
   */
  envLabel: string;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;

  /**
   * SvcRuntime is mandatory (ADR-0080). Entrypoint constructs it.
   */
  rt: SvcRuntime;
};

class GatewayApp extends AppBase {
  constructor(opts: CreateAppOptions) {
    // Initialize logger first so all subsequent boot logs have proper context.
    setLoggerEnv(opts.envDto);

    super({
      service: opts.slug,
      version: opts.version,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
      rt: opts.rt,
      // Gateway is NOT db-backed.
      checkDb: false,
    });
  }

  /**
   * Platform classification.
   *
   * Gateway is part of the platform surface (edge/proxy), so we classify it as "infra".
   * IMPORTANT: this does NOT mean "skip infra boot preflight".
   */
  public override isInfraService(): boolean {
    return true;
  }

  /**
   * ADR-0082 recursion avoidance hook.
   *
   * Gateway must still run infra boot health checks, because every request
   * depends on infra (env-service, svcconfig, etc.) being up.
   */
  public override shouldSkipInfraBootHealthCheck(): boolean {
    return false;
  }

  /**
   * Mount service routes.
   *
   * Health + env reload are mounted by AppBase under:
   *   /api/gateway/v<version>/health
   *   /api/gateway/v<version>/env/reload
   *
   * All proxied traffic uses the gateway router under `/api`.
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
  const app = new GatewayApp(opts);
  await app.boot();
  return { app: app.instance };
}
