// backend/services/svcfacilitator/src/controllers/ResolveController.v2.ts
/**
 * NowVibin (NV)
 * Path: backend/services/svcfacilitator/src/controllers/resolve.controller.v2.ts
 *
 * Docs:
 * - SOP: svcfacilitator is the source of truth; gateway mirrors from it.
 * - ADRs:
 *   - ADR-0010 — Resolve API (read contract)
 *   - ADR-0020 — SvcConfig Mirror & Push Design
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys, OO form)
 *   - ADR-0033 — Internal-Only Services & S2S Verification Defaults
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *
 * Purpose:
 * - Resolve "<slug>@<version>" from the **combined** in-memory mirror
 *   (svcconfig parent + grouped route_policies).
 * - Thin controller: validate → fetch from store → return entry.
 *
 * Behavior:
 * - 200 OK body (MirrorEntryV2):
 *   {
 *     serviceConfig: {
 *       _id: string, slug: string, version: number,
 *       enabled: boolean, updatedAt: string, updatedBy: string, notes?
 *     },
 *     policies: { edge: EdgeRoutePolicyDoc[], s2s: S2SRoutePolicyDoc[] }
 *   }
 *
 * Invariants:
 * - No env reads. Store owns TTL + LKG (filesystem-first).
 * - Mirror already excludes internalOnly/disabled parents upstream.
 */

import {
  ControllerBase,
  type HandlerResult,
} from "@nv/shared/base/ControllerBase";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import {
  routePolicyDocArraySchema,
  type EdgeRoutePolicyDoc,
  type S2SRoutePolicyDoc,
} from "@nv/shared/contracts/route_policies.contract";

import { MirrorStoreV2 } from "../services/mirrorStore.v2";
import type { MirrorEntryV2 } from "../repos/SvcConfigWithPoliciesRepo.v2";

export class ResolveController extends ControllerBase {
  // DI: MirrorStoreV2 provides TTL + LKG fallback
  constructor(private readonly store: MirrorStoreV2) {
    super({ service: "svcfacilitator" });
  }

  /** GET /resolve?key=<slug@version> */
  public async resolveByKey(ctx: {
    body: unknown;
    key?: string;
  }): Promise<HandlerResult> {
    const keyQ = String(ctx?.key ?? "").trim();
    if (!keyQ) {
      return this.fail(
        400,
        "missing_key",
        "expected query ?key=<slug@version>"
      );
    }

    const entry = await this.getEntryByKey(keyQ);
    if (!entry) {
      return this.fail(404, "not_found", `no record for key=${keyQ}`);
    }

    const v = this.validateEntry(keyQ, entry);
    if (!v.ok) {
      return this.fail(v.status, v.code, v.msg);
    }
    return this.ok(200, entry);
  }

  /** GET /resolve/:slug/v:version */
  public async resolveByParams(ctx: {
    body: unknown;
    slug: string;
    version: string;
  }): Promise<HandlerResult> {
    const slug = String(ctx.slug ?? "")
      .trim()
      .toLowerCase();
    const vRaw = Number(ctx.version);
    const version = Number.isFinite(vRaw) ? Math.trunc(vRaw) : NaN;

    if (!slug || !Number.isFinite(version) || version < 1) {
      return this.fail(
        400,
        "bad_params",
        "expected /resolve/:slug/v:version with version >= 1"
      );
    }

    const key = svcKey(slug, version);
    const entry = await this.getEntryByKey(key);
    if (!entry) {
      return this.fail(404, "not_found", `no record for key=${key}`);
    }

    const v = this.validateEntry(key, entry);
    if (!v.ok) {
      return this.fail(v.status, v.code, v.msg);
    }
    return this.ok(200, entry);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async getEntryByKey(key: string): Promise<MirrorEntryV2 | null> {
    const snap = await this.store.getWithTtl();
    const map = snap.map ?? {};
    const raw = (map as Record<string, MirrorEntryV2 | undefined>)[key];
    return raw ?? null;
  }

  /**
   * Lightweight validation to keep nice operator errors while trusting upstream filters:
   * - parent parses via ServiceConfigRecord (ensures ISO updatedAt, slug rules, etc.)
   * - key matches <slug>@<version>
   * - policies arrays contain only correct typed entries
   * - parent.enabled must be true (defensive check)
   */
  private validateEntry(
    key: string,
    entry: MirrorEntryV2
  ):
    | { ok: true }
    | {
        ok: false;
        status: 422 | 403 | 500;
        code: "invalid_record" | "key_mismatch" | "service_disabled";
        msg: string;
      } {
    try {
      // Parent strict parse/normalize
      const parentJson = new ServiceConfigRecord(entry.serviceConfig).toJSON();

      // Defensive enabled check
      if (parentJson.enabled !== true) {
        return {
          ok: false,
          status: 403,
          code: "service_disabled",
          msg: "service is disabled in svcconfig",
        };
      }

      // Key must match canonical
      const expectedKey = svcKey(parentJson.slug, parentJson.version);
      if (key !== expectedKey) {
        return {
          ok: false,
          status: 422,
          code: "key_mismatch",
          msg: `mirror key mismatch: '${key}' !== '${expectedKey}'`,
        };
      }

      // Children shape checks (already normalized, but keep the guardrails)
      const edges = routePolicyDocArraySchema.parse(
        entry.policies.edge
      ) as EdgeRoutePolicyDoc[];
      const s2s = routePolicyDocArraySchema.parse(
        entry.policies.s2s
      ) as S2SRoutePolicyDoc[];

      if (edges.some((p) => p.type !== "Edge")) {
        return {
          ok: false,
          status: 422,
          code: "invalid_record",
          msg: "policies.edge contains non-Edge entries",
        };
      }
      if (s2s.some((p) => p.type !== "S2S")) {
        return {
          ok: false,
          status: 422,
          code: "invalid_record",
          msg: "policies.s2s contains non-S2S entries",
        };
      }

      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        status: 422,
        code: "invalid_record",
        msg: String(e),
      };
    }
  }
}
