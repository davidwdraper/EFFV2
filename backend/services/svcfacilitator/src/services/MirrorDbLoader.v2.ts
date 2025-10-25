// backend/services/svcfacilitator/src/services/MirrorDbLoader.v2.ts
/**
 * Path: backend/services/svcfacilitator/src/services/MirrorDbLoader.v2.ts
 *
 * Purpose (locked):
 * - Repos → Domain entity (single normalization in ServiceConfig.fromDb) → Mirror → Wire.
 * - Loader never repicks DB fields; repos shape raw DTOs; domain validates loudly.
 * - DB is the source of truth. No env reads. No Zod here.
 *
 * Invariants:
 * - Named imports only.
 * - Keys in the mirror are "<slug>@<version>".
 * - Only enabled && !internalOnly parents are included (repo filter).
 */

import { getLogger } from "@nv/shared/logger/Logger";
import { Mirror } from "@nv/shared/domain/Mirror";
import {
  ServiceConfig,
  type EdgePolicy,
  type S2SPolicy,
} from "@nv/shared/domain/ServiceConfig";

import {
  ServiceConfigsRepo,
  type ServiceConfigDbDoc, // ← correct type name
} from "../repos/ServiceConfigsRepo";

import {
  RoutePoliciesRepo,
  type RoutePolicyDoc,
} from "../repos/RoutePoliciesRepo";

import type {
  ServiceConfigJSON,
  MirrorJSON,
} from "@nv/shared/contracts/serviceConfig.wire";

export type MirrorLoadResultV2 = {
  mirror: MirrorJSON;
  rawCount: number;
  activeCount: number;
  errors: Array<{ key: string; error: string }>;
};

export class MirrorDbLoader {
  private readonly log = getLogger().bind({
    service: "svcfacilitator",
    component: "MirrorDbLoaderV2",
    url: "/services/MirrorDbLoader.v2",
  });

  constructor(
    private readonly parentsRepo: ServiceConfigsRepo,
    private readonly policiesRepo: RoutePoliciesRepo
  ) {}

  async loadFullMirror(): Promise<MirrorLoadResultV2 | null> {
    this.log.debug("SVF300 load_from_db_start", {
      source: "repos→domain→mirror",
    });

    const started = Date.now();
    const parents = await this.parentsRepo.findVisibleParents();
    const latency = Date.now() - started;

    const rawCount = parents.length;
    if (rawCount === 0) {
      this.log.debug("SVF320 load_from_db_empty", { reason: "no_docs" });
      return null;
    }

    const entities: ServiceConfig[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    for (const row of parents as ServiceConfigDbDoc[]) {
      const kSlug = String((row as any)?.slug ?? "<unknown>");
      const kVer = String((row as any)?.version ?? "<unknown>");
      const draftKey = `${kSlug}@${kVer}`;

      try {
        const parentId = (row as any)._id;

        const [edgeRows, s2sRows] = await Promise.all([
          this.policiesRepo.findEnabledEdgeByParent(parentId),
          this.policiesRepo.findEnabledS2SByParent(parentId),
        ]);

        const edgePolicies: EdgePolicy[] = edgeRows.map(edgeToDomain);
        const s2sPolicies: S2SPolicy[] = s2sRows.map(s2sToDomain);

        // Pass repo-shaped object straight to the domain — single normalization hop.
        const entity = ServiceConfig.fromDb(row, {
          edge: edgePolicies,
          s2s: s2sPolicies,
        });

        entities.push(entity);
      } catch (err) {
        const msg = String(err);
        errors.push({ key: draftKey, error: msg });
        this.log.warn("SVF415 invalid_parent_or_policy", {
          key: draftKey,
          error: msg,
        });
      }
    }

    if (errors.length > 0) {
      throw new Error(`invalid_service_config_fields count=${errors.length}`);
    }
    if (entities.length === 0) {
      this.log.debug("SVF320 load_from_db_empty", {
        reason: "no_valid_entities",
        rawCount,
      });
      return null;
    }

    const mirror = Mirror.fromArray(entities);
    const wire: Record<string, ServiceConfigJSON> = mirror.toObject();

    this.log.debug("SVF310 load_from_db_ok", {
      rawCount,
      activeCount: mirror.size(),
      tookMs: latency,
      keys: mirror.keys(),
    });

    return {
      mirror: wire as MirrorJSON,
      rawCount,
      activeCount: mirror.size(),
      errors,
    };
  }
}

/* ------------------------- local adapters ------------------------- */
/**
 * Minimal adapters: keep coercion to essentials; the domain enforces invariants.
 */

function asIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > 0) return v;
  const d = new Date(v as any);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error("updatedAt must be a Date or ISO string");
}

function edgeToDomain(p: RoutePolicyDoc): EdgePolicy {
  return {
    type: "Edge",
    svcconfigId: (p as any).svcconfigId,
    _id: (p as any)._id,
    slug: String(p.slug),
    method: String(p.method) as EdgePolicy["method"],
    path: String(p.path),
    bearerRequired: Boolean((p as any).bearerRequired),
    enabled: Boolean(p.enabled),
    updatedAt: asIso(p.updatedAt),
    notes: (p as any).notes != null ? String((p as any).notes) : undefined,
    minAccessLevel:
      (p as any).minAccessLevel != null
        ? Number((p as any).minAccessLevel)
        : undefined,
  };
}

function s2sToDomain(p: RoutePolicyDoc): S2SPolicy {
  return {
    type: "S2S",
    svcconfigId: (p as any).svcconfigId,
    _id: (p as any)._id,
    slug: String(p.slug),
    method: String(p.method) as S2SPolicy["method"],
    path: String(p.path),
    enabled: Boolean(p.enabled),
    updatedAt: asIso(p.updatedAt),
    notes: (p as any).notes != null ? String((p as any).notes) : undefined,
  };
}
