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
 * - Strict validation: `enabled` and `internalOnly` must be booleans (no coercion).
 * - Returns counts and throws on invalid field types so upstream can fix data.
 *
 * Change Log:
 * - 2025-10-22: Switch to compounded repo (policies embedded)
 * - 2025-10-22: Add strict field validation (no boolean coercion)
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
  rawCount: number; // returned by repo
  activeCount: number; // inserted into the map
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
   * Returns null only if repo returned zero visible records *after* validation.
   * Throws if any record has invalid field types (so bad data is corrected at source).
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
      const sc = e?.serviceConfig as any;
      const keyDraft = `${sc?.slug ?? "<unknown>"}@${
        sc?.version ?? "<unknown>"
      }`;
      const id = this.safeId(sc?._id);

      try {
        // --- strict field validations (no coercion) ---
        this.assertBool(sc?.enabled, "enabled", id, sc?.slug, sc?.version);
        this.assertBool(
          sc?.internalOnly,
          "internalOnly",
          id,
          sc?.slug,
          sc?.version
        );

        // Normalize only non-semantic surfaces
        const normalized: MirrorEntryV2 = {
          ...e,
          serviceConfig: {
            ...sc,
            _id: this.asStringId(sc._id), // acceptable normalization
            // Keep updatedAt stable: to ISO if Date instance
            updatedAt:
              sc.updatedAt instanceof Date
                ? sc.updatedAt.toISOString()
                : sc.updatedAt,
          },
        };

        // Safety: repo should have filtered, but assert invariants here
        if (normalized.serviceConfig.enabled !== true) {
          throw new Error("enabled must be true for included records");
        }
        if (normalized.serviceConfig.internalOnly === true) {
          throw new Error("internalOnly records must not be included");
        }

        const key = svcKey(
          normalized.serviceConfig.slug,
          normalized.serviceConfig.version
        );
        mirror[key] = normalized;
      } catch (err) {
        const msg = String(err);
        errors.push({ key: keyDraft, error: msg });
        this.log.warn("SVF415 invalid_field", {
          id,
          slug: sc?.slug,
          version: sc?.version,
          error: msg,
        });
      }
    }

    if (errors.length > 0) {
      // Fail-fast so bad data gets fixed; logs include SVF415 per offending record.
      throw new Error(`invalid_service_config_fields count=${errors.length}`);
    }

    const activeCount = Object.keys(mirror).length;
    if (activeCount === 0) {
      this.log.debug("SVF320 load_from_db_empty", {
        reason: "no_valid_included_records",
        rawCount,
      });
      return null;
    }

    this.log.debug("SVF310 load_from_db_ok", {
      rawCount,
      activeCount,
      tookMs: latency,
    });

    return { mirror, rawCount, activeCount, errors };
  }

  // ─────────────────────────────── internals ────────────────────────────────

  private assertBool(
    v: unknown,
    field: "enabled" | "internalOnly",
    id: string,
    slug?: string,
    version?: number
  ): void {
    if (typeof v !== "boolean") {
      const t = typeof v;
      // Emit precise context to find & fix the doc
      this.log.warn("SVF415 invalid_field_type", {
        id,
        slug,
        version,
        field,
        type: t,
        value: String(v),
      });
      throw new Error(`${field}: expected boolean`);
    }
  }

  private safeId(v: unknown): string {
    try {
      return this.asStringId(v);
    } catch {
      return "<unknown_id>";
    }
  }

  private asStringId(id: unknown): string {
    if (typeof id === "string") return id;
    if (id && typeof id === "object") {
      const anyId = id as any;
      if (typeof anyId.$oid === "string") return anyId.$oid;
      if (typeof anyId.toHexString === "function") return anyId.toHexString();
      const s = String(anyId);
      if (s && s !== "[object Object]") return s;
    }
    throw new Error("_id: expected string-like");
  }
}
