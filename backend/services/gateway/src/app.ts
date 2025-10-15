// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - Addendum: `app.ts` as Orchestration Only
 * - ADRs:
 *   - ADR-0001, ADR-0003, ADR-0006, ADR-0013, ADR-0014, ADR-0026, ADR-0027
 *
 * Purpose:
 * - Orchestration only. Health routes (gateway-local) mounted by base first.
 * - Audit strictly around the proxy (never touches health).
 *   Sequence:
 *     health (base) → svcClientProvider → edge logs → auditBegin → healthProxyTrace → /api proxy → auditEnd → error sink
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";
import { edgeHitLogger } from "./middleware/edge.hit.logger";

import { auditBegin } from "./middleware/audit/audit.begin";
import { auditEnd } from "./middleware/audit/audit.end";
import { healthProxyTrace } from "./middleware/health.proxy.trace";
// import { verifyS2S } from "@nv/shared/middleware/verify.s2s"; // when ready

// Publish a single slug-aware client into app.locals.svcClient
import { svcClientProvider } from "./middleware/svc/SvcClientProvider";
import { SvcClient } from "@nv/shared/svc/SvcClient";

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
    const sc = (this.svcConfig ??= getSvcConfig());
    void sc.ensureLoaded().catch((err) => {
      this.log.error(
        { service: SERVICE, component: "GatewayApp", err },
        "***ERROR*** svcconfig warm-load failed"
      );
    });
  }

  /** Pre-routing: base mounts versioned health; then publish svcClient; then edge logs. */
  protected mountPreRouting(): void {
    super.mountPreRouting(); // mounts /api/gateway/v1/health/*

    // Publish the ONE slug-aware client for the whole app (proxy + audit share this)
    const sc = (this.svcConfig ??= getSvcConfig());
    this.app.use(
      svcClientProvider(() => {
        // SvcConfig canonical resolver: returns a VERSIONED base URL
        const resolveUrl = (slug: string, version = 1) =>
          sc.getUrlFromSlug(slug, version);
        return new SvcClient(resolveUrl, { timeoutMs: 5000 });
      })
    );

    this.app.use(edgeHitLogger());
    // this.app.use(verifyS2S()); // when enabled (after health, before proxy)
  }

  protected mountParsers(): void {
    /* proxy streams bodies intact */
  }

  /** Routes: audit strictly around the proxy; health is proxied but auto-skipped by audit.* */
  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    // BEGIN audit (auto-skip /health via internal check)
    this.app.use(auditBegin());

    // Trace only for proxied /health calls to workers (auth, user, etc.)
    this.app.use(healthProxyTrace({ logger: this.log }));

    // Proxy **all** /api/* to services (includes /api/<svc>/v1/health/*), but /health is NOT audited
    this.app.use("/api", new ProxyRouter(sc).router());

    // END audit (+ gentle flush) — also auto-skips /health
    this.app.use(auditEnd());

    // 🔴 Critical: global error sink MUST be last
    this.app.use(responseErrorLogger(this.log));
  }
}
