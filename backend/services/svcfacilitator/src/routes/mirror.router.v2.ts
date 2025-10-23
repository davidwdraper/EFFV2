// backend/services/svcfacilitator/src/routes/mirror.router.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0038 — Authorization Hierarchy and Enforcement
 *   - ADR-0019 — Class Routers via RouterBase
 *
 * Purpose:
 * - Brand-new v2 router for the Mirror endpoint.
 * - Routes are one-liners: import controller only, no logic here.
 *
 * Invariants:
 * - No environment reads; DI provides all tuning.
 * - Versioned path convention: /api/<slug>/v<major>/mirror
 * - Single concern: HTTP routing/wiring (no business logic).
 */

import type { Router } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { MirrorStore, type MirrorSnapshot } from "../cache/MirrorStore.v2";
import {
  MirrorController,
  type MirrorSnapshotBody,
} from "../controllers/mirror.controller.v2";

export interface BuildMirrorRouterDeps<T extends MirrorSnapshotBody> {
  /** In-memory snapshot cache (v2). */
  store: MirrorStore<T>;
  /**
   * Loader that builds a fresh snapshot from DB for { slug, version }.
   * Must set meta.generatedAt (ISO) and meta.ttlSeconds (>0).
   */
  loader: (args: {
    slug: string;
    version: number;
  }) => Promise<MirrorSnapshot<T>>;
  /** Facilitator TTL in ms (owner-controlled, required > 0). */
  ttlMs: number;
  /** Service slug for versioned base path guard (e.g., "svcfacilitator"). */
  serviceSlug?: string; // optional; base-path guard is advisory here
  logger?: {
    debug?(o: unknown, msg?: string): void;
    warn?(o: unknown, msg?: string): void;
    error?(o: unknown, msg?: string): void;
  };
}

/**
 * Class-based router (v2). Usage in app.v2.ts:
 *   const r = buildMirrorRouterV2({ store, loader, ttlMs, serviceSlug: "svcfacilitator" });
 *   app.use("/api/svcfacilitator/v1", r);
 */
export function buildMirrorRouterV2<T extends MirrorSnapshotBody>(
  deps: BuildMirrorRouterDeps<T>
): Router {
  class MirrorRouterV2 extends RouterBase {
    private readonly ctrl = new MirrorController<T>({
      store: deps.store,
      loader: deps.loader,
      ttlMs: deps.ttlMs,
      logger: deps.logger,
    });

    protected configure(): void {
      // One-liner route: controller handles everything.
      // Path is relative to the mounted /api/<slug>/v<major> base.
      this.get("/mirror", this.ctrl.mirror);
    }
  }

  const router = new MirrorRouterV2({
    context: { component: "MirrorRouter.v2" },
  });
  return router.router();
}
