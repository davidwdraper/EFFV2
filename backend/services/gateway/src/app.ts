// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - Addendum: `app.ts` as Orchestration Only
 * - ADRs: 0001, 0003, 0006, 0013, 0014, 0026, 0027, 0033, 0038
 *
 * Purpose:
 * - Orchestration only. Defines order; no business logic.
 *   Sequence:
 *     health(base)
 *       → svcClientProvider
 *       → edge logs
 *       → audit bootstrap
 *       → routePolicyGate  (SECURITY — guardrail denials happen here)
 *       → auditBegin       (WAL ring starts)
 *       → auditEnd         (WAL ring ends)
 *       → healthProxyTrace
 *       → /api proxy
 *       → error sink
 */

import { AppBase } from "@nv/shared/base/AppBase";
import EnvLoader from "@nv/shared/env/EnvLoader";

import { responseErrorLogger } from "@nv/shared/middleware/response.error.logger";
// import { verifyS2S } from "@nv/shared/middleware/verify.s2s";

import type { SvcConfig } from "./services/svcconfig/SvcConfig";
import { getSvcConfig } from "./services/svcconfig/SvcConfig";
import { ProxyRouter } from "./routes/proxy.router";

import { edgeHitLogger } from "./middleware/edge.hit.logger";
import { auditBegin } from "./middleware/audit/audit.begin";
import { auditEnd } from "./middleware/audit/audit.end";
import { healthProxyTrace } from "./middleware/health.proxy.trace";

import { svcClientProvider } from "./middleware/svc/SvcClientProvider";
import { getSvcClient } from "@nv/shared/svc/client";

import { GatewayAuditBootstrap } from "./bootstrap/GatewayAuditBootstrap";
import { routePolicyGate } from "./middleware/routePolicyGate";
import type { ISvcconfigResolver } from "./middleware/routePolicyGate";

const SERVICE = "gateway";

/** Thin adapter: make SvcConfig look like ISvcconfigResolver without changing SvcConfig. */
function svcconfigResolverAdapter(sc: SvcConfig): ISvcconfigResolver {
  return {
    getSvcconfigId(slug: string): string | null {
      const anySc = sc as unknown as Record<string, any>;
      // Try a few common shapes without coupling types:
      // 1) Direct method
      if (typeof anySc.getSvcconfigId === "function") {
        const v = anySc.getSvcconfigId(slug);
        return typeof v === "string" ? v : null;
      }
      if (typeof anySc.getId === "function") {
        const v = anySc.getId(slug);
        return typeof v === "string" ? v : null;
      }
      // 2) Lookup record → pull id field
      const rec =
        (typeof anySc.get === "function" && anySc.get(slug)) ||
        (typeof anySc.findBySlug === "function" && anySc.findBySlug(slug)) ||
        null;
      const id =
        rec?.svcconfigId ??
        rec?._id ??
        rec?.id ??
        (typeof anySc.id === "function" ? anySc.id(slug) : null);
      return typeof id === "string" ? id : null;
    },
  };
}

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

    const sharedSvcClient = getSvcClient(); // FacilitatorResolver under the hood
    this.app.use(svcClientProvider(() => sharedSvcClient));
    this.app.use(edgeHitLogger());
    // this.app.use(verifyS2S());

    await GatewayAuditBootstrap.init({
      app: this.app,
      log: this.log,
      svcClient: sharedSvcClient,
    });
  }

  protected mountParsers(): void {
    /* proxy streams bodies intact */
  }

  /** Routes: SECURITY (routePolicy) runs before WAL audit ring */
  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    // ── Route Policy Gate (security) — blocks anon by default; sets minAccess for token gate
    const facilitatorBaseUrl = process.env.SVCFACILITATOR_BASE_URL!;
    const ttlMsRaw = process.env.GATEWAY_ROUTE_POLICY_TTL_MS;
    const ttlMs = Number(ttlMsRaw);
    const fetchTimeoutMs = process.env.ROUTE_POLICY_FETCH_TIMEOUT_MS
      ? Number(process.env.ROUTE_POLICY_FETCH_TIMEOUT_MS)
      : undefined;

    if (!facilitatorBaseUrl?.trim()) {
      this.log.error(
        {
          service: SERVICE,
          component: "GatewayApp",
          var: "SVCFACILITATOR_BASE_URL",
        },
        "***FATAL*** routePolicyGate env missing"
      );
      throw new Error("routePolicyGate: SVCFACILITATOR_BASE_URL missing");
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      this.log.error(
        {
          service: SERVICE,
          component: "GatewayApp",
          var: "GATEWAY_ROUTE_POLICY_TTL_MS",
          ttlMsRaw,
        },
        "***FATAL*** routePolicyGate ttl invalid"
      );
      throw new Error("routePolicyGate: ttlMs invalid");
    }

    this.log.debug(
      {
        service: SERVICE,
        component: "GatewayApp",
        note: "mounting routePolicyGate",
        facilitatorBaseUrl,
        ttlMs,
      },
      "route_policy_gate_mount"
    );

    // Adapter makes SvcConfig satisfy the resolver interface
    const resolver = svcconfigResolverAdapter(sc);

    this.app.use(
      routePolicyGate({
        bindLog: this.bindLog.bind(this),
        facilitatorBaseUrl,
        ttlMs,
        resolver,
        fetchTimeoutMs,
      })
    );

    // ── WAL audit ring strictly around the proxy (only for requests that pass security)
    this.app.use(auditBegin());
    this.app.use(auditEnd());

    this.app.use(healthProxyTrace({ logger: this.log }));
    this.app.use("/api", new ProxyRouter(sc).router());

    this.app.use(responseErrorLogger(this.log));
  }
}
