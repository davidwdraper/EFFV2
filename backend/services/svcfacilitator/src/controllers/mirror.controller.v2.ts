// backend/services/svcfacilitator/src/controllers/mirror.controller.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0038 — Authorization Hierarchy and Enforcement
 *
 * Purpose:
 * - Brand-new v2 controller class for the Mirror endpoint.
 * - Returns a cached per-service snapshot via injected MirrorStore + loader().
 *
 * Invariants:
 * - No environment reads; all tuning injected via constructor.
 * - Routes are one-liners: router binds controller.mirror (no logic in router).
 * - Single concern: HTTP orchestration only; no DB/HTTP inside this class.
 */

import type { Request, Response, NextFunction } from "express";
import { ControllerBase } from "@nv/shared//base/ControllerBase";
import { MirrorStore, type MirrorSnapshot } from "../cache/MirrorStore.v2";

// Recommended concrete snapshot shape: { serviceConfig, policies: { edge, s2s } }
export interface MirrorSnapshotBody {
  [k: string]: unknown;
}

export interface MirrorResponse<T extends MirrorSnapshotBody> {
  key: string; // "<slug>@<version>"
  snapshot: T;
  meta: {
    generatedAt: string; // ISO when produced by loader
    ttlSeconds: number; // facilitator-declared TTL (seconds)
  };
}

export interface MirrorControllerDeps<T extends MirrorSnapshotBody> {
  store: MirrorStore<T>;
  /**
   * Loader that produces a fresh MirrorSnapshot for { slug, version }.
   * MUST set meta.generatedAt (ISO) and meta.ttlSeconds (>0).
   * Performs all I/O (DB reads) and normalization.
   */
  loader: (args: {
    slug: string;
    version: number;
  }) => Promise<MirrorSnapshot<T>>;
  /**
   * Facilitator TTL in milliseconds for this key (owner-controlled).
   * Gateway will cache only the remainder based on generatedAt.
   */
  ttlMs: number;
  logger?: {
    debug?(o: unknown, msg?: string): void;
    warn?(o: unknown, msg?: string): void;
    error?(o: unknown, msg?: string): void;
  };
}

/**
 * Usage from router (one-liner):
 *   const ctrl = new MirrorController(deps);
 *   router.get("/mirror", ctrl.mirror);
 */
export class MirrorController<
  T extends MirrorSnapshotBody
> extends ControllerBase {
  private readonly store: MirrorStore<T>;
  private readonly loader: (args: {
    slug: string;
    version: number;
  }) => Promise<MirrorSnapshot<T>>;
  private readonly ttlMs: number;
  private readonly logx: NonNullable<MirrorControllerDeps<T>["logger"]>;

  constructor(deps: MirrorControllerDeps<T>) {
    super({ context: { component: "MirrorController.v2" } });

    if (!deps?.store) throw new Error("MirrorController: store is required");
    if (!deps?.loader) throw new Error("MirrorController: loader is required");
    if (typeof deps.ttlMs !== "number" || deps.ttlMs <= 0) {
      throw new Error("MirrorController: ttlMs must be a positive number");
    }

    this.store = deps.store;
    this.loader = deps.loader;
    this.ttlMs = deps.ttlMs;

    const noop = (_o?: unknown, _m?: string) => {};
    this.logx = {
      debug: deps.logger?.debug ?? noop,
      warn: deps.logger?.warn ?? noop,
      error: deps.logger?.error ?? noop,
    };
  }

  /**
   * GET /api/svcfacilitator/v1/mirror?slug=...&version=...
   * Router mounts as a one-liner: router.get("/mirror", ctrl.mirror);
   */
  public mirror = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slugRaw = String(req.query.slug ?? "").trim();
      const versionRaw = String(req.query.version ?? "").trim();

      if (!slugRaw) {
        return res.status(400).json({
          type: "about:blank",
          title: "bad_request",
          status: 400,
          detail: "Missing query parameter: slug",
        });
      }
      const versionNum = Number(versionRaw);
      if (!versionRaw || !Number.isFinite(versionNum) || versionNum <= 0) {
        return res.status(400).json({
          type: "about:blank",
          title: "bad_request",
          status: 400,
          detail: "Query parameter 'version' must be a positive number",
        });
      }

      const key = `${slugRaw}@${versionNum}`;
      this.logx.debug?.({ key }, "mirror_request");

      const snap = await this.store.get(
        key,
        () => this.loader({ slug: slugRaw, version: versionNum }),
        this.ttlMs
      );

      const body: MirrorResponse<T> = {
        key,
        snapshot: snap.snapshot,
        meta: {
          generatedAt: snap.meta.generatedAt,
          ttlSeconds: snap.meta.ttlSeconds,
        },
      };

      return res.status(200).json(body);
    } catch (err) {
      this.logx.error?.({ err: String(err) }, "mirror_handler_error");
      return next(err);
    }
  };
}
