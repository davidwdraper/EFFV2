// backend/services/svcfacilitator/src/app.v2.ts
/**
 * NowVibin (NV)
 * File: backend/services/svcfacilitator/src/app.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - Addendum: app.ts as Orchestration Only
 * - ADRs:
 *   - ADR-0014 — Base Hierarchy (Entrypoint → AppBase → ServiceBase)
 *   - ADR-0019 — Class Routers via RouterBase
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0038 — Authorization Hierarchy and Enforcement
 *
 * Purpose:
 * - Orchestrates SvcFacilitator v2 runtime. Defines order only; no business logic.
 * - Lifecycle/middleware order from AppBase:
 *     onBoot → health → preRouting → security → parsers → routes → postRouting
 *
 * Notes:
 * - Mirror is DB-backed in v2. Router constructs its own loader (Option 2).
 * - This file stays glanceable: constants up top, one-liners for mounts.
 */

import { AppBase } from "@nv/shared/base/AppBase";
import { MirrorStore } from "./cache/MirrorStore.v2";
import { buildMirrorRouterV2 } from "./routes/mirror.router.v2";
import type { MirrorSnapshotBodyV2 } from "./loaders/mirror.loader.v2";

const SERVICE = "svcfacilitator";
const V1_BASE = `/api/${SERVICE}/v1`;

export class SvcFacilitatorAppV2 extends AppBase {
  constructor() {
    super({ service: SERVICE });
  }

  private mirrorStore?: MirrorStore<MirrorSnapshotBodyV2>;
  private mirrorTtlMs!: number;

  protected healthBasePath(): string | null {
    return V1_BASE;
  }

  protected async onBoot(): Promise<void> {
    // Fail-fast envs (no fallbacks, no literals)
    const maxEntries = this.getEnvInt("MIRROR_CACHE_MAX_ENTRIES")!;
    const negativeTtlMs = this.getEnvInt("MIRROR_NEGATIVE_TTL_MS")!;
    this.mirrorTtlMs = this.getEnvInt("MIRROR_TTL_MS")!;

    // Cache owned here; loader is built inside the router (Option 2).
    this.mirrorStore = new MirrorStore<MirrorSnapshotBodyV2>({
      maxEntries,
      negativeTtlMs,
      logger: {
        debug: (o, m) => this.log.debug(o as any, m),
        info: (o, m) => this.log.info(o as any, m),
        warn: (o, m) => this.log.warn(o as any, m),
        error: (o, m) => this.log.error(o as any, m),
      },
    });

    this.log.info(
      { maxEntries, negativeTtlMs, mirrorTtlMs: this.mirrorTtlMs },
      "mirror_store_initialized_v2"
    );
  }

  /** Pre-routing: keep glanceable; add TEMP debug or public bypass here if needed. */
  protected mountPreRouting(): void {
    super.mountPreRouting(); // responseErrorLogger, etc.
    // this.app.use(debugInboundHeaders(this.log)); // (optional TEMP)
  }

  /** Security layer placeholder — verifyS2S would mount here (post-ADR wiring). */
  protected mountSecurity(): void {
    // this.app.use(publicResolveBypass(this.log)); // (optional TEMP)
    // verifyS2S would go here in the future.
  }

  protected mountRoutes(): void {
    if (!this.mirrorStore) {
      throw new Error("mirrorStore not initialized — run onBoot() first");
    }

    // v2 Mirror: router builds its own DB loader; app passes primitives only.
    this.app.use(
      V1_BASE,
      buildMirrorRouterV2<MirrorSnapshotBodyV2>({
        db: this.db,
        store: this.mirrorStore,
        ttlMs: this.mirrorTtlMs,
        serviceSlug: SERVICE,
        logger: {
          debug: (o, m) => this.log.debug(o as any, m),
          warn: (o, m) => this.log.warn(o as any, m),
          error: (o, m) => this.log.error(o as any, m),
        },
      })
    );

    // TODO (next): wire resolve.router.v2 + routePolicy.router.v2
    // this.app.use(V1_BASE, buildResolveRouterV2({ ... }));
    // this.app.use(V1_BASE, buildRoutePolicyRouterV2({ ... }));

    this.log.info(
      { base: V1_BASE, routes: ["GET /mirror"] },
      "routes_mounted_v2"
    );
  }

  /** Ready when app is booted; mirror is lazy-loaded on first hit. */
  protected readyCheck(): () => boolean {
    return () => true;
  }
}
