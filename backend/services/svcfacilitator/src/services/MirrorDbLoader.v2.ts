// backend/services/svcfacilitator/src/services/MirrorDbLoader.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/services/MirrorDbLoader.v2.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0020 — SvcConfig Mirror & Push Design
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys, OO form)
 *   - ADR-0008 — SvcFacilitator LKG (boot resilience when DB is down)
 *   - ADR-0033 — Internal-Only Services & S2S Verification Defaults
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - DB-backed loader for the *combined* mirror: each visible service_config
 *   parent (enabled && !internalOnly) with its enabled route_policies embedded.
 * - **No env reads here** (DI only). LKG and TTL are handled by the store layer.
 *
 * Behavior:
 * - loadFullMirror(): returns a map keyed by "<slug>@<version>" with values:
 *     { serviceConfig: { _id, slug, version, enabled, updatedAt, updatedBy, notes? },
 *       policies: { edge: EdgeRoutePolicyDoc[], s2s: S2SRoutePolicyDoc[] } }
 * - Returns counts (raw/active) for observability and an errors array (reserved).
 *
 * Environment Invariance:
 * - Zero literals/defaults. DB access lives in the injected repo.
 *
 * Change Log:
 * - 2025-10-22: Switch from direct Mongo scan to compounded repo
 *               (parent + children in one trip). Mirror now carries policies.
 */

import { getLogger } from "@nv/shared/logger/Logger";
import { svcKey } from "@nv/shared/contracts/svcconfig.contract";
import {
  SvcConfigWithPoliciesRepoV2,
  type MirrorEntryV2,
} from "../repos/SvcConfigWithPoliciesRepo.v2";

export type MirrorMapV2 = Record<string, MirrorEntryV2>;

export type MirrorLoadResultV2 = {
  mirror: MirrorMapV2;
  rawCount: number; // number of entries returned by repo
  activeCount: number; // number inserted into the map (after keying)
  errors: Array<{ key: string; error: string }>;
};

export class MirrorDbLoader {
  private readonly log = getLogger().bind({
    service: "svcfacilitator",
    component: "MirrorDbLoaderV2",
    url: "/services/MirrorDbLoader.v2",
  });

  /** Compounded repo (parent + policies). DI from owning service. */
  private readonly repo: SvcConfigWithPoliciesRepoV2;

  constructor(repo: SvcConfigWithPoliciesRepoV2) {
    this.repo = repo;
  }

  /**
   * Load the full combined mirror (visible parents + enabled policies).
   * Returns null only if repo returned zero visible records.
   */
  async loadFullMirror(): Promise<MirrorLoadResultV2 | null> {
    this.log.debug("SVF300 load_from_db_start", { source: "repo.compounded" });

    const started = Date.now();
    const entries = await this.repo.findVisibleWithPolicies();
    const latency = Date.now() - started;

    const rawCount = entries.length;
    if (rawCount === 0) {
      this.log.debug("SVF320 load_from_db_empty", { reason: "no_docs" });
      return null;
    }

    const mirror: MirrorMapV2 = Object.create(null);
    const errors: Array<{ key: string; error: string }> = [];

    for (const e of entries) {
      try {
        const key = svcKey(e.serviceConfig.slug, e.serviceConfig.version);
        mirror[key] = e;
      } catch (err) {
        const key = `${e?.serviceConfig?.slug ?? "<unknown>"}@${
          e?.serviceConfig?.version ?? "<unknown>"
        }`;
        errors.push({ key, error: String(err) });
        this.log.warn("SVF420 mirror_key_fail", {
          key,
          error: `mirror_key_build_failed: ${String(err)}`,
        });
      }
    }

    const activeCount = Object.keys(mirror).length;
    if (activeCount === 0) {
      this.log.debug("SVF320 load_from_db_empty", {
        reason: "no_valid_included_records",
      });
      return null;
    }

    this.log.debug("SVF310 load_from_db_ok", {
      rawCount,
      activeCount,
      invalidCount: errors.length,
      tookMs: latency,
    });

    return { mirror, rawCount, activeCount, errors };
  }
}
