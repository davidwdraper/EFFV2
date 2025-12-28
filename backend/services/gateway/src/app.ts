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
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *
 * Purpose:
 * - Gateway is a pure proxy service.
 * - Mounts a catch-all proxy router under `/api` so inbound service paths remain
 *   identical end-to-end (only the target port/host differs).
 *
 * Invariants:
 * - Posture is the single source of truth (no checkDb duplication).
 * - SvcRuntime is REQUIRED: AppBase ctor must receive rt.
 * - Gateway-owned health/env reload remain under `/api/gateway/v1/*` (AppBase).
 * - Proxy router MUST be mounted at `/api` (not `/api/gateway/v1`).
 */

import type { Express, Router } from "express";
import { AppBase } from "@nv/shared/base/app/AppBase";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";
import type { SvcPosture } from "@nv/shared/runtime/SvcPosture";
import { buildGatewayRouter } from "./routes/gateway.route";

export type CreateAppOptions = {
  slug: string;
  version: number;
  posture: SvcPosture;

  envDto: EnvServiceDto;
  envReloader: () => Promise<EnvServiceDto>;

  rt: SvcRuntime;
};

class GatewayApp extends AppBase {
  constructor(opts: CreateAppOptions) {
    super({
      service: opts.slug,
      version: opts.version,
      posture: opts.posture,
      envDto: opts.envDto,
      envReloader: opts.envReloader,
      rt: opts.rt,
    });
  }

  protected override mountRoutes(): void {
    // Health/env-reload are mounted by AppBase under `/api/gateway/v1/*`.
    // Proxy traffic MUST be mounted at `/api` so the inbound path is unchanged.
    const base = "/api";

    const r: Router = buildGatewayRouter(this);
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
  const app = new GatewayApp(opts);
  await app.boot();
  return { app: app.instance };
}
