// backend/services/svcfacilitator/src/repos/SvcConfigWithPoliciesRepo.v2.ts
/**
 * Docs / SOP
 * - SOP: Reduced, Clean
 * - ADR-0007: SvcConfig Contract — fixed shapes & keys (OO form)
 * - ADR-0033: Internal-Only Services & S2S Verification Defaults
 * - ADR-0037: Unified Route Policies (Edge + S2S)
 *
 * Purpose
 * - Return the *combined* mirror entries:
 *   parent service_config + its enabled route_policies (edge + s2s).
 *
 * Environment Invariance
 * - No env reads. Collections are DI. No driver types leak.
 */

import { getLogger } from "@nv/shared/logger/Logger";

type BsonLike = Record<string, unknown>;

/** Minimal collection surface so we don’t leak the Mongo driver types. */
export interface MinimalCollection {
  find(filter: unknown, options?: unknown): { toArray(): Promise<unknown[]> };
}

// ── Contract-facing types (mirror payload) ───────────────────────────────────

export type ServiceConfigParent = {
  _id: string;
  slug: string;
  version: number;
  enabled: boolean;
  internalOnly: boolean;
  baseUrl: string;
  outboundApiPrefix: string;
  exposeHealth: boolean;
  updatedAt: string;
  updatedBy: string;
  notes?: string;
};

export type EdgeRoutePolicyDoc = {
  _id: string;
  svcconfigId: string;
  type: "Edge";
  slug: string;
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
  path: string;
  bearerRequired: boolean;
  enabled: boolean;
  updatedAt: string;
  notes?: string;
  minAccessLevel?: number;
};

export type S2SRoutePolicyDoc = {
  _id: string;
  svcconfigId: string;
  type: "S2S";
  slug: string;
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
  path: string;
  enabled: boolean;
  updatedAt: string;
  notes?: string;
  minAccessLevel?: number;
  allowedCallers?: string[];
  scopes?: string[];
};

export type MirrorEntryV2 = {
  serviceConfig: ServiceConfigParent;
  policies: {
    edge: EdgeRoutePolicyDoc[];
    s2s: S2SRoutePolicyDoc[];
  };
};

// ── Repo ─────────────────────────────────────────────────────────────────────

export class SvcConfigWithPoliciesRepoV2 {
  private readonly log = getLogger().bind({
    service: "svcfacilitator",
    component: "SvcConfigWithPoliciesRepoV2",
    url: "/repos/svcconfig.withPolicies.v2",
  });

  constructor(
    private readonly serviceConfigs: MinimalCollection,
    private readonly routePolicies: MinimalCollection
  ) {
    assertCollection("serviceConfigs", serviceConfigs);
    assertCollection("routePolicies", routePolicies);
  }

  /**
   * Returns all *visible* parents (enabled:true, internalOnly:false; both booleans),
   * along with their *enabled* route policies (Edge + S2S).
   *
   * Driver-agnostic: uses only find().toArray().
   */
  async findVisibleWithPolicies(): Promise<MirrorEntryV2[]> {
    // Fetch parents that claim enabled/internalOnly; we’ll re-validate types below.
    const parentRows = (await this.serviceConfigs
      .find({ enabled: true, internalOnly: false })
      .toArray()) as BsonLike[];

    this.log.debug(
      { stage: "parent_fetch", count: parentRows.length },
      "SVF301 repo_parent_fetch"
    );

    const out: MirrorEntryV2[] = [];

    for (const row of parentRows) {
      // Strict boolean/type guards — skip anything that fails.
      if (row == null) continue;
      if (typeof (row as any).enabled !== "boolean") continue;
      if ((row as any).enabled !== true) continue;
      if (typeof (row as any).internalOnly !== "boolean") continue;
      if ((row as any).internalOnly !== false) continue;

      // Required fields
      if (!row.baseUrl || !row.outboundApiPrefix || row.exposeHealth == null)
        continue;
      if (!row.updatedAt || !row.updatedBy) continue;

      // Build parent (strict)
      const rawId = (row as any)._id;
      const parent: ServiceConfigParent = {
        _id: asStringId(rawId),
        slug: String((row as any).slug),
        version: Number((row as any).version),
        enabled: true,
        internalOnly: false,
        baseUrl: String(row.baseUrl),
        outboundApiPrefix: String(row.outboundApiPrefix),
        exposeHealth: Boolean(row.exposeHealth),
        updatedAt: asIso(row.updatedAt),
        updatedBy: String(row.updatedBy),
        notes: row.notes != null ? String(row.notes) : undefined,
      };

      // Fetch enabled Edge policies for this parent
      const edgeRows = (await this.routePolicies
        .find({ svcconfigId: rawId, enabled: true, type: "Edge" })
        .toArray()) as BsonLike[];

      const s2sRows = (await this.routePolicies
        .find({ svcconfigId: rawId, enabled: true, type: "S2S" })
        .toArray()) as BsonLike[];

      const edge: EdgeRoutePolicyDoc[] = edgeRows.map(toEdgePolicyStrict);
      const s2s: S2SRoutePolicyDoc[] = s2sRows.map(toS2SPolicyStrict);

      out.push({
        serviceConfig: parent,
        policies: { edge, s2s },
      });
    }

    this.log.debug(
      { stage: "parent_include", included: out.length },
      "SVF302 repo_parent_include"
    );

    return out;
  }
}

// ── Helpers (no env, no IO) ─────────────────────────────────────────────────

function assertCollection(name: string, c: any): void {
  const ok =
    c &&
    typeof c.find === "function" &&
    typeof c.find({}).toArray === "function";
  if (!ok) {
    throw new Error(
      `DI for ${name} is not a collection (missing find().toArray())`
    );
  }
}

function asStringId(id: unknown): string {
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

function asIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  const d = new Date(v as any);
  return d.toISOString();
}

function toEdgePolicyStrict(p: any): EdgeRoutePolicyDoc {
  return {
    _id: asStringId(p._id),
    svcconfigId: asStringId(p.svcconfigId),
    type: "Edge",
    slug: String(p.slug),
    method: p.method as EdgeRoutePolicyDoc["method"],
    path: String(p.path),
    bearerRequired: Boolean(p.bearerRequired),
    enabled: Boolean(p.enabled),
    updatedAt: asIso(p.updatedAt),
    notes: p.notes != null ? String(p.notes) : undefined,
    minAccessLevel:
      p.minAccessLevel != null ? Number(p.minAccessLevel) : undefined,
  };
}

function toS2SPolicyStrict(p: any): S2SRoutePolicyDoc {
  const out: S2SRoutePolicyDoc = {
    _id: asStringId(p._id),
    svcconfigId: asStringId(p.svcconfigId),
    type: "S2S",
    slug: String(p.slug),
    method: p.method as S2SRoutePolicyDoc["method"],
    path: String(p.path),
    enabled: Boolean(p.enabled),
    updatedAt: asIso(p.updatedAt),
    notes: p.notes != null ? String(p.notes) : undefined,
    minAccessLevel:
      p.minAccessLevel != null ? Number(p.minAccessLevel) : undefined,
  };
  if (Array.isArray(p.allowedCallers)) {
    out.allowedCallers = p.allowedCallers.map((s: any) => String(s));
  }
  if (Array.isArray(p.scopes)) {
    out.scopes = p.scopes.map((s: any) => String(s));
  }
  return out;
}
