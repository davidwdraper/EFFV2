// backend/services/gateway/src/resolvers/SvcconfigResolver.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0038 — Route Policy Gate at Gateway & Facilitator Endpoints
 * - Addendum: Single-Concern Class Principle
 *
 * Purpose:
 * - Minimal adapter so routePolicyGate can resolve svcconfigId by slug.
 * - Uses ONLY SvcConfig.getRecord(slug). If it’s missing, that’s a config/ops issue:
 *   log a loud **WARN** and return null (gate will block).
 *
 * Invariants:
 * - No env reads. No extra probing. One call, one reason to change.
 */

import type { IBoundLogger } from "@nv/shared/logger/Logger";
import type { ISvcconfigResolver } from "../middleware/routePolicyGate";
import type { SvcConfig } from "../services/svcconfig/SvcConfig";

export class SvcconfigResolver implements ISvcconfigResolver {
  constructor(
    private readonly sc: SvcConfig,
    private readonly log: IBoundLogger
  ) {}

  public getSvcconfigId(slug: string): string | null {
    const s = (slug ?? "").toLowerCase();

    try {
      const rec = (this.sc as any).getRecord?.(s);
      if (!rec) {
        // This is an ops/config problem: known service missing at mirror.
        this.log.warn(
          { component: "SvcconfigResolver", slug: s },
          "***WARN*** missing svcconfig record for slug"
        );
        return null;
      }

      const id =
        unwrapId(rec?.svcconfigId) ?? unwrapId(rec?._id) ?? unwrapId(rec?.id);

      if (!id) {
        // Record exists but lacks an id we can use — also an ops/config issue.
        this.log.warn(
          {
            component: "SvcconfigResolver",
            slug: s,
            recKeys: Object.keys(rec || {}),
          },
          "***WARN*** svcconfig record missing usable id"
        );
        return null;
      }

      return id;
    } catch (e) {
      // Unexpected failure querying the mirror — loud and clear.
      this.log.error(
        {
          component: "SvcconfigResolver",
          slug: s,
          error:
            e instanceof Error
              ? { name: e.name, message: e.message, stack: e.stack }
              : { message: String(e) },
        },
        "***ERROR*** svcconfig resolver threw"
      );
      return null;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function unwrapId(idLike: unknown): string | null {
  if (!idLike) return null;
  if (typeof idLike === "string") return idLike;
  if (typeof idLike === "object") {
    const o = idLike as any;
    // Common Mongo shapes: { $oid: "…" }, or simple string props
    if (typeof o.$oid === "string") return o.$oid;
    if (typeof o._id === "string") return o._id;
    if (typeof o.id === "string") return o.id;
  }
  return null;
}
