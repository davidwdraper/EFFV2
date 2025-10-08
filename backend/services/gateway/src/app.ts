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
 * - GatewayApp now overrides AppBase hooks; all app.use() ordering lives in AppBase.
 * - Health is mounted first, then edge logs, then (no parsers), then proxy, then error funnel.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { makeProxy } from "./routes/proxy";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";

const SERVICE = "gateway";

export class GatewayApp extends AppBase {
  private svcConfig?: SvcConfig;

  constructor() {
    super({ service: SERVICE });
  }

  // 0) Warm the svcconfig mirror early (fire-and-forget).
  protected onBoot(): void {
    const sc = (this.svcConfig ??= getSvcConfig());
    void sc.ensureLoaded().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gateway] svcconfig warm-load failed:", String(err));
    });
  }

  // 1) Versioned health base path (required per SOP).
  protected healthBasePath(): string | null {
    return "/api/gateway/v1";
  }

  // 1b) Readiness ties to svcconfig entry count.
  protected readyCheck(): () => boolean {
    return () => {
      try {
        return (this.svcConfig ?? getSvcConfig()).count() > 0;
      } catch {
        return false;
      }
    };
  }

  // 2) Pre-routing: add edge hit logger (and keep base response-error logger).
  protected mountPreRouting(): void {
    super.mountPreRouting();
    this.app.use(edgeHitLogger());
  }

  // 3) Security: (reserved for verifyS2S later). No-op for now.
  // protected mountSecurity(): void { super.mountSecurity(); }

  // 4) Parsers: gateway does NOT parse bodies for /api/*; keep it empty.
  protected mountParsers(): void {
    // intentionally blank — proxy streams bodies; see SOP
  }

  // 5) Routes: mount the proxy at /api (origin swap only; path/query unchanged).
  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());
    this.app.use("/api", makeProxy(sc));
  }

  // 6) Post-routing error funnel is inherited (JSON 500).
}
