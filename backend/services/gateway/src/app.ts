// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0001 (Gateway-Embedded SvcConfig mirror)
 *   - ADR-0003 (Gateway pulls svc map from svcfacilitator)
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR-0013 (Versioned Health — local, never proxied)
 *   - ADR-0014 (Base Hierarchy — ServiceEntrypoint → AppBase → ServiceBase)
 *
 * Purpose:
 * - GatewayApp mounts versioned health first, then edge logs, then proxy, then error funnel.
 * - Environment invariance: no host/port literals; all via env/config.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";

const SERVICE = "gateway";

export class GatewayApp extends AppBase {
  private svcConfig?: SvcConfig;

  constructor() {
    super({ service: SERVICE });
  }

  protected onBoot(): void {
    const sc = (this.svcConfig ??= getSvcConfig());
    void sc.ensureLoaded().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gateway] svcconfig warm-load failed:", String(err));
    });
  }

  protected healthBasePath(): string | null {
    return "/api/gateway/v1";
  }

  protected readyCheck(): () => boolean {
    return () => {
      try {
        return (this.svcConfig ?? getSvcConfig()).count() > 0;
      } catch {
        return false;
      }
    };
  }

  protected mountPreRouting(): void {
    super.mountPreRouting();
    this.app.use(edgeHitLogger());
  }

  protected mountParsers(): void {
    // Intentionally empty — proxy streams bodies unchanged.
  }

  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());
    // Mount the proxy router at /api; controller will reject /api/gateway/*
    this.app.use("/api", new ProxyRouter(sc).router());
  }
}
