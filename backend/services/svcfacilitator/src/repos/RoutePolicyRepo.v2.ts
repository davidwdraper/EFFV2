// backend/services/svcfacilitator/src/repos/RoutePolicyRepo.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0022 — Shared WAL & DB Base (RepoBase)
 *
 * Purpose:
 * - Brand-new v2 repository for `route_policies` used by mirror/resolve.
 * - Single concern: Mongo access + normalization via shared contract helpers.
 *
 * Invariants:
 * - No environment reads here; caller provides DbClient and logger.
 * - Returns **normalized docs only** (ObjectIds as strings) using contract parsers.
 * - Enabled-only reads for mirror/resolve paths.
 *
 * Index plan:
 * - Unique: { svcconfigId: 1, type: 1, method: 1, path: 1 }
 * - Filter: { svcconfigId: 1, enabled: 1, type: 1 }
 */

import type { WithId, Document, IndexDescription } from "mongodb";
import type { DbClient } from "@nv/shared/db/DbClient";
import { RepoBase } from "@nv/shared/base/RepoBase";
import {
  parseRoutePolicies,
  type RoutePolicyDoc,
  type EdgeRoutePolicyDoc,
  type S2SRoutePolicyDoc,
} from "@nv/shared/contracts/route_policies.contract";

type RoutePolicyMongo = WithId<Document>;

/** Strict shapes for mirror output: `_id` is guaranteed present. */
export type EdgeRoutePolicyStrict = Omit<EdgeRoutePolicyDoc, "_id"> & {
  _id: string;
};
export type S2SRoutePolicyStrict = Omit<S2SRoutePolicyDoc, "_id"> & {
  _id: string;
};

/** Grouped return shape used by the mirror loader. */
export type RoutePolicyGroupV2 = {
  edge: EdgeRoutePolicyStrict[];
  s2s: S2SRoutePolicyStrict[];
};

export interface RoutePolicyRepoOptions {
  dbName?: string;
}

export class RoutePolicyRepoV2 extends RepoBase<RoutePolicyMongo> {
  constructor(db: DbClient, opts?: RoutePolicyRepoOptions) {
    super(db, {
      collection: "route_policies",
      dbName: opts?.dbName,
    });
    void this.ensureIndexes(this.indexes());
  }

  /** Minimal indexes helpful for our hot paths. */
  private indexes(): IndexDescription[] {
    return [
      {
        key: { svcconfigId: 1, type: 1, method: 1, path: 1 },
        unique: true,
        name: "svcconfig_type_method_path_unique",
      },
      {
        key: { svcconfigId: 1, enabled: 1, type: 1 },
        name: "svcconfig_enabled_type",
      },
    ];
  }

  /**
   * Return all **enabled** policies for a given svcconfigId, normalized and grouped.
   * Guarantees `_id: string` on every returned policy (throws if missing).
   */
  public async findEnabledGroupedBySvcconfigId(
    svcconfigId: string
  ): Promise<RoutePolicyGroupV2> {
    const docs = await this.withRetry(async () => {
      const c = await this.coll();
      const cursor = c.find(
        { svcconfigId, enabled: true },
        {
          projection: {
            _id: 1,
            svcconfigId: 1,
            slug: 1,
            type: 1,
            method: 1,
            path: 1,
            bearerRequired: 1,
            enabled: 1,
            allowedCallers: 1,
            scopes: 1,
            updatedAt: 1,
            notes: 1,
            minAccessLevel: 1,
            changedByUserId: 1, // ops-only visibility
          },
        }
      );
      return cursor.toArray();
    }, "route_policies.findEnabledGroupedBySvcconfigId");

    if (!docs || docs.length === 0) {
      return { edge: [], s2s: [] };
    }

    // Normalize via shared contract (IDs → strings, strict types)
    const normalized = parseRoutePolicies(docs as unknown) as RoutePolicyDoc[];

    // Enforce `_id` presence (mirror schema requires it)
    const edge: EdgeRoutePolicyStrict[] = [];
    const s2s: S2SRoutePolicyStrict[] = [];

    for (const p of normalized) {
      if (!p._id) {
        // From Mongo this should never happen; fail fast to avoid ambiguous mirrors.
        throw new Error(
          `RoutePolicy missing _id for svcconfigId=${svcconfigId} ${p.method} ${p.path}`
        );
      }
      if (p.type === "Edge") {
        edge.push({
          ...(p as EdgeRoutePolicyDoc),
          _id: p._id,
        } as EdgeRoutePolicyStrict);
      } else {
        s2s.push({
          ...(p as S2SRoutePolicyDoc),
          _id: p._id,
        } as S2SRoutePolicyStrict);
      }
    }

    return { edge, s2s };
  }
}
