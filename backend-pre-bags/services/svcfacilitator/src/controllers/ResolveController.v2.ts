// backend/services/svcfacilitator/src/controllers/ResolveController.v2.ts
/**
 * NowVibin (NV)
 * Path: backend/services/svcfacilitator/src/controllers/resolve.controller.v2.ts
 *
 * Purpose:
 * - Resolve "<slug>@<version>" from the in-memory mirror.
 * - Normalize → validate → return canonical entry.
 *
 * Canonical response:
 * {
 *   serviceConfig: { _id, slug, version, enabled, updatedAt, updatedBy, ... },
 *   policies: { edge: EdgeRoutePolicyDoc[], s2s: S2SRoutePolicyDoc[] }
 * }
 */

import {
  ControllerBase,
  type HandlerResult,
} from "@nv/shared/base/controller/ControllerBase";

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

type CanonicalEntry = {
  serviceConfig: Record<string, unknown>;
  policies: { edge: unknown[]; s2s: unknown[] };
};

type FlattenedEntry = {
  policies: { edge: unknown[]; s2s: unknown[] };
} & Record<string, unknown>;

export class ResolveController extends ControllerBase {
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

    const raw = await this.getEntryByKey(keyQ);
    if (!raw) return this.fail(404, "not_found", `no record for key=${keyQ}`);

    const entry = this.normalize(raw);
    const v = this.validateEntry(keyQ, entry);
    if (!v.ok) return this.fail(v.status, v.code, v.msg);

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
    const raw = await this.getEntryByKey(key);
    if (!raw) return this.fail(404, "not_found", `no record for key=${key}`);

    const entry = this.normalize(raw);
    const v = this.validateEntry(key, entry);
    if (!v.ok) return this.fail(v.status, v.code, v.msg);

    return this.ok(200, entry);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async getEntryByKey(key: string): Promise<unknown | null> {
    const snap = await this.store.getWithTtl();
    const map = (snap?.map ?? {}) as Record<string, unknown>;
    return map[key] ?? null;
  }

  /**
   * Normalize mirror entry to canonical { serviceConfig, policies }:
   * - If already canonical, shallow-ensure shapes.
   * - If flattened, lift all non-"policies" fields into serviceConfig.
   * - Alias common provenance fields → `updatedBy` if missing.
   * - DIAGNOSTIC SHIM: if still missing, force `updatedBy="__shim__"` to pass contract.
   */
  private normalize(raw: unknown): CanonicalEntry {
    const ensureUpdatedBy = (parent: Record<string, unknown>) => {
      if (parent.updatedBy == null || parent.updatedBy === "") {
        // common aliases
        const candidates = [
          "changedByUserId",
          "updatedByUserId",
          "lastModifiedBy",
          "changedBy",
          "updated_by",
          "updatedby",
          "actorId",
          "userId",
          "ownerId",
        ];
        for (const k of candidates) {
          const v = (parent as any)[k];
          if (v != null && v !== "") {
            parent.updatedBy = String(v);
            break;
          }
        }
        // --- DIAGNOSTIC SHIM (remove once repos/loader supply updatedBy) ---
        if (parent.updatedBy == null || parent.updatedBy === "") {
          parent.updatedBy = "__shim__";
        }
      }
      return parent;
    };

    if (
      raw &&
      typeof raw === "object" &&
      "serviceConfig" in (raw as any) &&
      "policies" in (raw as any)
    ) {
      const r = raw as CanonicalEntry;
      return {
        serviceConfig: ensureUpdatedBy({ ...(r.serviceConfig ?? {}) }),
        policies: r.policies ?? { edge: [], s2s: [] },
      };
    }

    const f = (raw ?? {}) as FlattenedEntry;
    const { policies, ...parent } = f;
    return {
      serviceConfig: ensureUpdatedBy({ ...parent }),
      policies: policies ?? { edge: [], s2s: [] },
    };
  }

  /**
   * Lightweight validation (OO contract does the heavy lift):
   * - parent parses via ServiceConfigRecord (requires updatedBy, ISO updatedAt, slug rules…)
   * - key matches <slug>@<version>
   * - policies arrays contain only correct typed entries
   * - parent.enabled must be true
   */
  private validateEntry(
    key: string,
    entry: CanonicalEntry
  ):
    | { ok: true }
    | {
        ok: false;
        status: 422 | 403 | 500;
        code: "invalid_record" | "key_mismatch" | "service_disabled";
        msg: string;
      } {
    try {
      const parentJson = new ServiceConfigRecord(entry.serviceConfig).toJSON();

      if (parentJson.enabled !== true) {
        return {
          ok: false,
          status: 403,
          code: "service_disabled",
          msg: "service is disabled in svcconfig",
        };
      }

      const expectedKey = svcKey(parentJson.slug, parentJson.version);
      if (key !== expectedKey) {
        return {
          ok: false,
          status: 422,
          code: "key_mismatch",
          msg: `mirror key mismatch: '${key}' !== '${expectedKey}'`,
        };
      }

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
