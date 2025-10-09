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
 *   - ADR-0022 (Shared WAL & DB Base; environment invariance)
 *   - ADR-0024 (SvcClient/SvcReceiver refactor for S2S)
 *
 * Purpose:
 * - Health first, then edge logs, then audit logger, then proxy, then error funnel.
 * - No endpoint guessing: SvcClient resolves slug@version via SvcConfig.
 * - Audit batching is owned locally (GatewayAuditService) with mandatory FS WAL.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";
import { auditLogger } from "./middleware/audit.logger";
import { GatewayAuditService } from "./services/audit/GatewayAuditService";
import { SvcClient } from "@nv/shared/svc/SvcClient";

const SERVICE = "gateway";

export class GatewayApp extends AppBase {
  private svcConfig?: SvcConfig;
  private audit?: GatewayAuditService;

  constructor() {
    super({ service: SERVICE });
  }

  protected onBoot(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    // Warm SvcConfig (failures are logged, readiness gate will still protect /api)
    void sc.ensureLoaded().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gateway] svcconfig warm-load failed:", String(err));
    });

    // ---- Shared SvcClient using SvcConfig as UrlResolver (no URL literals) ----
    const svc = new SvcClient(async (slug, version) => {
      const url = (sc as any).baseUrl?.(slug, version);
      if (typeof url !== "string" || url.length === 0) {
        throw new Error(
          `[gateway] SvcConfig missing baseUrl for ${slug}@${version}`
        );
      }
      return url;
    });

    // ---- Gateway-local audit batching (FS WAL mandatory; enforced in Wal.fromEnv) ----
    const gwLog = this.bindLog({ component: "GatewayAuditService" });
    this.audit = new GatewayAuditService({
      logger: gwLog,
      svc, // ← canonical S2S path (SvcClient → SvcReceiver)
    });
    this.audit.start();
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
    // Required order: edge → audit → (future: s2s guards) → proxy
    this.app.use(edgeHitLogger());
    if (!this.audit) {
      throw new Error("[gateway] audit service not initialized");
    }
    this.app.use(auditLogger(this.audit));
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
