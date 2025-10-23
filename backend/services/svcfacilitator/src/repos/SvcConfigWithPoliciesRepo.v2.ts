// backend/services/svcfacilitator/src/repos/SvcConfigWithPoliciesRepo.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys)
 *   - ADR-0033 — Internal-Only Services & S2S Verification Defaults
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Repository for compounded service-config + route-policy data (single concern).
 * - One DB trip returns normalized parents (service_configs)
 *   with their enabled route_policies grouped under them.
 * - Filtering rules enforced here:
 *   - internalOnly === true → excluded
 *   - enabled === false → excluded
 *   - route_policies.enabled === true only
 *
 * Behavior:
 * - Returns records matching the MirrorEntryV2 shape:
 *   {
 *     serviceConfig: { _id, slug, version, enabled, updatedAt, updatedBy, notes? },
 *     policies: { edge: EdgeRoutePolicyDoc[], s2s: S2SRoutePolicyDoc[] }
 *   }
 *
 * Invariants:
 * - No env reads, no defaults. DB is injected (DI).
 * - IDs are strings above this repo (ObjectIds unwrapped here).
 */

import type { Collection, Document } from "mongodb";
import { ObjectId } from "mongodb";
import { DbClient } from "@nv/shared/db/DbClient";
import {
  ServiceConfigRecord,
  type ServiceConfigRecordJSON,
} from "@nv/shared/contracts/svcconfig.contract";
import {
  parseRoutePolicies,
  type EdgeRoutePolicyDoc,
  type S2SRoutePolicyDoc,
} from "@nv/shared/contracts/route_policies.contract";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Raw Mongo document in service_configs (pre-normalization). */
type ServiceConfigMongoDoc = {
  _id: ObjectId;
  slug: string;
  version: number;
  enabled: boolean;
  internalOnly: boolean;
  baseUrl: string;
  outboundApiPrefix: string;
  exposeHealth: boolean;
  updatedAt: string | Date | { $date: string };
  updatedBy: string;
  notes?: string;
  port?: number | null;
  // lookup materialized by aggregation
  policiesAll?: unknown[];
};

export type MirrorEntryV2 = {
  serviceConfig: Pick<
    ServiceConfigRecordJSON,
    "_id" | "slug" | "version" | "enabled" | "updatedAt" | "updatedBy" | "notes"
  > & { _id: string };
  policies: {
    edge: EdgeRoutePolicyDoc[];
    s2s: S2SRoutePolicyDoc[];
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Repo
// ─────────────────────────────────────────────────────────────────────────────

export class SvcConfigWithPoliciesRepoV2 {
  private readonly db: DbClient;
  private _coll?: Collection<ServiceConfigMongoDoc>;
  private _indexesEnsured = false;

  /** DI: service passes a ready DbClient it owns. */
  constructor(dbClient: DbClient) {
    this.db = dbClient;
  }

  /** Lazily connect and return the service_configs collection. */
  private async coll(): Promise<Collection<ServiceConfigMongoDoc>> {
    if (this._coll) return this._coll;
    const c = (await this.db.getCollection<ServiceConfigMongoDoc>(
      "service_configs"
    )) as Collection<ServiceConfigMongoDoc>;
    this._coll = c;
    await this.ensureIndexes(c);
    return c;
  }

  /** Ensure expected index exists (idempotent). */
  private async ensureIndexes(
    c: Collection<ServiceConfigMongoDoc>
  ): Promise<void> {
    if (this._indexesEnsured) return;
    await c.createIndex(
      { slug: 1, version: 1 },
      { unique: true, name: "uniq_slug_version" }
    );
    this._indexesEnsured = true;
  }

  // ── Core queries ───────────────────────────────────────────────────────────

  /** Fetch all visible svcconfigs with enabled policies (for mirrors). */
  public async findVisibleWithPolicies(): Promise<MirrorEntryV2[]> {
    const c = await this.coll();

    const pipeline: Document[] = [
      { $match: { internalOnly: false, enabled: true } },
      {
        $lookup: {
          from: "route_policies",
          let: { svcId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$svcconfigId", "$$svcId"] },
                enabled: true,
              },
            },
          ],
          as: "policiesAll",
        },
      },
      {
        $project: {
          _id: 1,
          slug: 1,
          version: 1,
          enabled: 1,
          updatedAt: 1,
          updatedBy: 1,
          notes: 1,
          policiesAll: 1,
        },
      },
    ];

    const docs = await c.aggregate<ServiceConfigMongoDoc>(pipeline).toArray();
    return docs.map((doc) => this.toMirrorEntry(doc));
  }

  /** Fetch one svcconfig by slug/version with enabled policies (for resolve). */
  public async findOneWithPoliciesBySlugVersion(
    slug: string,
    version: number
  ): Promise<MirrorEntryV2 | null> {
    const c = await this.coll();

    const pipeline: Document[] = [
      { $match: { slug, version, internalOnly: false, enabled: true } },
      {
        $lookup: {
          from: "route_policies",
          let: { svcId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$svcconfigId", "$$svcId"] },
                enabled: true,
              },
            },
          ],
          as: "policiesAll",
        },
      },
      {
        $project: {
          _id: 1,
          slug: 1,
          version: 1,
          enabled: 1,
          updatedAt: 1,
          updatedBy: 1,
          notes: 1,
          policiesAll: 1,
        },
      },
    ];

    const results = await c
      .aggregate<ServiceConfigMongoDoc>(pipeline)
      .toArray();
    if (results.length === 0) return null;
    return this.toMirrorEntry(results[0]);
  }

  // ── Internal normalization ─────────────────────────────────────────────────

  private toMirrorEntry(raw: ServiceConfigMongoDoc): MirrorEntryV2 {
    // Normalize parent via contract (also normalizes updatedAt to ISO)
    const svcJson = new ServiceConfigRecord({
      ...raw,
      _id:
        raw._id instanceof ObjectId
          ? raw._id.toHexString()
          : (raw as any)._id?.$oid ?? String((raw as any)._id ?? ""),
    }).toJSON();

    // Normalize children via route_policies contract
    const normalizedPolicies = Array.isArray(raw.policiesAll)
      ? parseRoutePolicies(
          raw.policiesAll.map((p: any) => ({
            ...p,
            _id:
              p._id instanceof ObjectId
                ? p._id.toHexString()
                : p._id?.$oid ?? String(p._id ?? ""),
            svcconfigId:
              p.svcconfigId instanceof ObjectId
                ? p.svcconfigId.toHexString()
                : p.svcconfigId?.$oid ?? String(p.svcconfigId ?? ""),
          }))
        )
      : [];

    const edge = normalizedPolicies.filter(
      (p) => p.type === "Edge"
    ) as EdgeRoutePolicyDoc[];
    const s2s = normalizedPolicies.filter(
      (p) => p.type === "S2S"
    ) as S2SRoutePolicyDoc[];

    const minimalSvc = {
      _id: String(svcJson._id ?? ""),
      slug: svcJson.slug,
      version: svcJson.version,
      enabled: svcJson.enabled,
      updatedAt: svcJson.updatedAt,
      updatedBy: svcJson.updatedBy,
      notes: svcJson.notes,
    };

    return {
      serviceConfig: minimalSvc,
      policies: { edge, s2s },
    };
  }
}
