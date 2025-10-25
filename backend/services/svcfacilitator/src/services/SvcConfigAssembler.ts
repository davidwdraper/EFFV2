// backend/services/svcfacilitator/src/services/SvcConfigAssembler.ts
/**
 * Docs / SOP
 * - SOP: Core SOP (Reduced, Clean)
 * - ADR-0007 / ADR-0020 / ADR-0032
 *
 * Purpose
 * - Compose single-concern repos to produce the combined mirror entries
 *   your controllers currently expect (MirrorEntryV2).
 *
 * Notes
 * - This is intentionally *not* a RepoBase subclass. It’s a pure assembler.
 */

import type { ServiceConfigDoc } from "../repos/ServiceConfigsRepo";
import { ServiceConfigsRepo } from "../repos/ServiceConfigsRepo";
import {
  RoutePoliciesRepo,
  type RoutePolicyDoc,
} from "../repos/RoutePoliciesRepo";
import type {
  EdgeRoutePolicyDoc,
  S2SRoutePolicyDoc,
  MirrorEntryV2,
  ServiceConfigParent,
} from "../repos/SvcConfigWithPoliciesRepo.v2"; // reuse your existing public types

export class SvcConfigAssembler {
  constructor(
    private readonly parents: ServiceConfigsRepo,
    private readonly policies: RoutePoliciesRepo
  ) {}

  /**
   * Returns the *combined* shape your current controllers & store expect:
   * MirrorEntryV2 = { serviceConfig, policies:{edge[], s2s[]} }
   */
  async loadCombinedEntries(): Promise<MirrorEntryV2[]> {
    const rows = await this.parents.findVisibleParents();
    const out: MirrorEntryV2[] = [];
    for (const row of rows) {
      const [edgeRows, s2sRows] = await Promise.all([
        this.policies.findEnabledEdgeByParent(row._id),
        this.policies.findEnabledS2SByParent(row._id),
      ]);
      const parent = toParent(row);
      const edge = edgeRows.map(toEdgePolicyStrict);
      const s2s = s2sRows.map(toS2SPolicyStrict);
      out.push({ serviceConfig: parent, policies: { edge, s2s } });
    }
    return out;
  }
}

// ── local strict normalizers (mirror the ones in your existing repo) ──

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

function toParent(row: ServiceConfigDoc): ServiceConfigParent {
  return {
    _id: asStringId(row._id),
    slug: String(row.slug),
    version: Number(row.version),
    enabled: true,
    internalOnly: false,
    baseUrl: String(row.baseUrl),
    outboundApiPrefix: row.outboundApiPrefix
      ? String(row.outboundApiPrefix)
      : "",
    exposeHealth: !!row.exposeHealth,
    updatedAt: asIso(row.updatedAt),
    updatedBy: row.updatedBy ? String(row.updatedBy) : "unknown",
    notes: row.notes != null ? String(row.notes) : undefined,
  };
}

function toEdgePolicyStrict(p: RoutePolicyDoc): EdgeRoutePolicyDoc {
  return {
    _id: asStringId(p._id),
    svcconfigId: asStringId(p.svcconfigId),
    type: "Edge",
    slug: String(p.slug),
    method: p.method,
    path: String(p.path),
    bearerRequired: !!p.bearerRequired,
    enabled: !!p.enabled,
    updatedAt: asIso(p.updatedAt),
    notes: p.notes != null ? String(p.notes) : undefined,
    minAccessLevel:
      p.minAccessLevel != null ? Number(p.minAccessLevel) : undefined,
  };
}

function toS2SPolicyStrict(p: RoutePolicyDoc): S2SRoutePolicyDoc {
  const out: S2SRoutePolicyDoc = {
    _id: asStringId(p._id),
    svcconfigId: asStringId(p.svcconfigId),
    type: "S2S",
    slug: String(p.slug),
    method: p.method,
    path: String(p.path),
    enabled: !!p.enabled,
    updatedAt: asIso(p.updatedAt),
    notes: p.notes != null ? String(p.notes) : undefined,
    minAccessLevel:
      p.minAccessLevel != null ? Number(p.minAccessLevel) : undefined,
  };
  if (Array.isArray(p.allowedCallers))
    (out as any).allowedCallers = p.allowedCallers.map(String);
  if (Array.isArray(p.scopes)) (out as any).scopes = p.scopes.map(String);
  return out;
}
