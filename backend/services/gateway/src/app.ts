// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - Addendum: `app.ts` as Orchestration Only
 * - ADRs:
 *   - ADR-0001, ADR-0003, ADR-0006, ADR-0013, ADR-0014, ADR-0026
 *
 * Purpose:
 * - Orchestration only. Health routes (gateway-local) mounted by base first.
 * - Audit strictly around the proxy (never touches health).
 *   Sequence:
 *     health (base) → edge logs → auditBegin → healthProxyTrace → /api proxy → auditEnd → error sink
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";
import { edgeHitLogger } from "./middleware/edge.hit.logger";

import { auditBegin } from "./middleware/audit.begin";
import { auditEnd } from "./middleware/audit.end";
import { healthProxyTrace } from "./middleware/health.proxy.trace";
// import { verifyS2S } from "@nv/shared/middleware/verify.s2s"; // when ready

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

  /** Pre-routing: base mounts versioned health; then edge logs. */
  protected mountPreRouting(): void {
    super.mountPreRouting(); // mounts /api/gateway/v1/health/*
    this.app.use(edgeHitLogger());
    // this.app.use(verifyS2S()); // when enabled (after health, before proxy)
  }

  protected mountParsers(): void {
    /* proxy streams bodies intact */
  }

  /** Routes: audit strictly around the proxy; health excluded by audit.* internals. */
  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    // BEGIN audit (no-op for health due to internal bypass)
    this.app.use(auditBegin());

    // Trace only for proxied /health calls to workers (auth, user, etc.)
    this.app.use(healthProxyTrace({ logger: this.log }));

    // Proxy **all** /api/* to services (includes /api/<svc>/v1/health/*)
    this.app.use("/api", new ProxyRouter(sc).router());

    // END audit (+ gentle flush) — also bypasses health internally
    this.app.use(auditEnd());

    // 🔴 Critical: global error sink MUST be last
    this.app.use(responseErrorLogger(this.log));
  }
}
