// backend/services/gateway/src/app.ts
/**
 * NowVibin (NV)
 * File: backend/services/gateway/src/app.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - Addendum: `app.ts` as Orchestration Only
 * - ADRs: 0001, 0003, 0006, 0013, 0014, 0026, 0027, 0033, 0038
 *
 * Purpose:
 * - Orchestrates the Gateway runtime sequence — defines order only.
 * - Inherits full lifecycle and middleware order from AppBase:
 *     onBoot → health → preRouting → routePolicy → security → parsers → routes → postRouting
 *
 * Invariants:
 * - Health mounts first (never gated).
 * - routePolicyGate enforced centrally in AppBase (resolver provided here).
 * - No duplicated middleware (responseErrorLogger etc.).
 */

import { AppBase } from "@nv/shared/base/AppBase";
import EnvLoader from "@nv/shared/env/EnvLoader";

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

import type { ISvcconfigResolver } from "@nv/shared/middleware/policy/routePolicyGate";
import type { IBoundLogger } from "@nv/shared/logger/Logger";

const SERVICE = "gateway";

/** Strict, contract-first adapter: maps slug@version → svcconfig _id */
function svcconfigResolverAdapter(
  sc: SvcConfig,
  log: IBoundLogger
): ISvcconfigResolver {
  return {
    getSvcconfigId(slug: string, version: number): string | null {
      const s = (slug ?? "").toLowerCase();
      if (!Number.isFinite(version) || version <= 0) {
        log.error(
          { component: "SvcconfigResolver", slug: s, version },
          "invalid version"
        );
        return null;
      }

      const rec = (sc as any).getRecord?.(s, version);
      if (!rec) {
        log.warn(
          { component: "SvcconfigResolver", slug: s, version },
          "missing svcconfig record"
        );
        return null;
      }

      const id = unwrapId((rec as any)?._id);
      if (!id) {
        log.error(
          {
            component: "SvcconfigResolver",
            slug: s,
            version,
            haveKeys: Object.keys(rec || {}),
          },
          "missing usable _id (contract breach)"
        );
        return null;
      }
      return id;
    },
  };
}

function unwrapId(idLike: unknown): string | null {
  if (!idLike) return null;
  if (typeof idLike === "string") return idLike;
  if (typeof idLike === "object") {
    const o = idLike as any;
    if (typeof o.$oid === "string") return o.$oid;
    if (typeof o._id === "string") return o._id;
    if (typeof o.id === "string") return o.id;
  }
  return null;
}

export class GatewayApp extends AppBase {
  private svcConfig?: SvcConfig;

  constructor() {
    super({ service: SERVICE });
  }

  /** Versioned health base path. */
  protected healthBasePath(): string | null {
    return "/api/gateway/v1";
  }

  /** Health ready when svcconfig mirror has loaded at least one record. */
  protected readyCheck(): () => boolean {
    return () => {
      try {
        return (this.svcConfig ?? getSvcConfig()).count() > 0;
      } catch {
        return false;
      }
    };
  }

  /** Boot: load envs and warm svcconfig mirror. */
  protected async onBoot(): Promise<void> {
    EnvLoader.loadAll({
      cwd: process.cwd(),
      debugLogger: (msg) =>
        this.log.debug({ service: SERVICE, component: "EnvLoader" }, msg),
    });

    const sc = (this.svcConfig ??= getSvcConfig());
    await sc.ensureLoaded().catch((err) => {
      this.log.error(
        { service: SERVICE, component: "GatewayApp", err },
        "svcconfig warm-load failed"
      );
    });
  }

  /** Pre-routing: publish SvcClient → edge logs → audit bootstrap. */
  protected async mountPreRouting(): Promise<void> {
    super.mountPreRouting(); // responseErrorLogger

    const sharedSvcClient = getSvcClient();
    this.app.use(svcClientProvider(() => sharedSvcClient));
    this.app.use(edgeHitLogger());

    await GatewayAuditBootstrap.init({
      app: this.app,
      log: this.log,
      svcClient: sharedSvcClient,
    });
  }

  /** Gateway streams requests to downstream; no JSON parsing here. */
  protected mountParsers(): void {
    /* intentionally empty */
  }

  /** RoutePolicyGate handled by AppBase; only proxy and audit rings here. */
  protected mountRoutes(): void {
    const sc = (this.svcConfig ??= getSvcConfig());

    // ── WAL audit ring around proxy
    this.app.use(auditBegin());
    this.app.use(auditEnd());

    this.app.use(healthProxyTrace({ logger: this.log }));
    this.app.use("/api", new ProxyRouter(sc).router());
  }

  /** Supply resolver for shared routePolicyGate. */
  protected getSvcconfigResolver(): ISvcconfigResolver | null {
    const sc = (this.svcConfig ??= getSvcConfig());
    return svcconfigResolverAdapter(
      sc,
      this.log.bind({ component: "SvcResolver" })
    );
  }
}
