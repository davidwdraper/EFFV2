// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: Reduced, Clean
 * - Addendum: `app.ts` as Orchestration Only
 * - ADRs: 0001, 0003, 0006, 0013, 0014, 0026, 0027
 *
 * Purpose:
 * - Orchestration only. Defines order; no business logic.
 *   Sequence:
 *     health(base) → svcClientProvider → edge logs → audit bootstrap → auditBegin → healthProxyTrace → /api proxy → auditEnd → error sink
 *
 * Design notes:
 * - The shared SvcClient **must** come from @nv/shared/svc/client so it uses the
 *   FacilitatorResolver that returns a **composed base**:
 *     <baseUrl><outboundApiPrefix>/<slug>/v<version>
 *   This avoids the legacy plain-base URL returned by svcconfig directly.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";
import { edgeHitLogger } from "./middleware/edge.hit.logger";
// import { verifyS2S } from "@nv/shared/middleware/verify.s2s"; // later

import { auditBegin } from "./middleware/audit/audit.begin";
import { auditEnd } from "./middleware/audit/audit.end";
import { healthProxyTrace } from "./middleware/health.proxy.trace";

import { svcClientProvider } from "./middleware/svc/SvcClientProvider";
// ❗ Use the shared singleton accessor that’s wired to the FacilitatorResolver:
import { getSvcClient } from "@nv/shared/svc/client";

import EnvLoader from "@nv/shared/env/EnvLoader";
import { GatewayAuditBootstrap } from "./bootstrap/GatewayAuditBootstrap";

const SERVICE = "gateway";

export class GatewayApp extends AppBase {
  private svcConfig?: SvcConfig;

  constructor() {
    super({ service: SERVICE });
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

  protected onBoot(): void {
    EnvLoader.loadAll({
      cwd: process.cwd(),
      debugLogger: (msg) =>
        this.log.debug({ service: SERVICE, component: "EnvLoader" }, msg),
    });

    const sc = (this.svcConfig ??= getSvcConfig());
    void sc.ensureLoaded().catch((err) => {
      this.log.error(
        { service: SERVICE, component: "GatewayApp", err },
        "***ERROR*** svcconfig warm-load failed"
      );
    });
  }

  /** Pre-routing: base health → publish SvcClient → edge logs → audit bootstrap */
  protected async mountPreRouting(): Promise<void> {
    super.mountPreRouting(); // mounts /api/gateway/v1/health/*

    // ── Shared, resolver-backed client (composed bases) ──────────────────────
    const sharedSvcClient = getSvcClient(); // ← uses FacilitatorResolver (versioned /resolve)

    // Publish shared client to req.app.locals for downstream consumers
    this.app.use(svcClientProvider(() => sharedSvcClient));

    // Edge ingress logs
    this.app.use(edgeHitLogger());
    // this.app.use(verifyS2S()); // when enabled

    // DI: WAL + HttpAuditWriter + (optional) replay-on-boot — encapsulated
    await GatewayAuditBootstrap.init({
      app: this.app,
      log: this.log,
      svcClient: sharedSvcClient,
    });
  }

  protected mountParsers(): void {
    /* proxy streams bodies intact */
  }

  /** Routes: audit ring strictly around the proxy */
  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    this.app.use(auditBegin());
    this.app.use(healthProxyTrace({ logger: this.log }));
    this.app.use("/api", new ProxyRouter(sc).router());
    this.app.use(auditEnd());

    // MUST be last
    this.app.use(responseErrorLogger(this.log));
  }
}
