// backend/services/svcfacilitator/src/repos/RoutePoliciesRepo.ts
/**
 * Docs / SOP
 * - SOP: Core SOP (Reduced, Clean)
 * - ADR-0032: Route Policy Gate — Edge & S2S
 *
 * Purpose
 * - Single-concern repo for `route_policies` collection.
 * - Fetch enabled policies by parent id, partitioned by type.
 */

import { RepoBase } from "@nv/shared/base/RepoBase";
import type { DbClient } from "@nv/shared/db/DbClient";

export type RoutePolicyDoc = {
  _id: unknown;
  svcconfigId: unknown;
  type: "Edge" | "S2S";
  slug: string;
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
  path: string;
  enabled: boolean;
  updatedAt: string | Date;
  // Edge-only:
  bearerRequired?: boolean;
  minAccessLevel?: number;
  // S2S extras (optional in DB):
  allowedCallers?: string[];
  scopes?: string[];
  notes?: string;
};

export class RoutePoliciesRepo extends RepoBase<RoutePolicyDoc> {
  constructor(db: DbClient) {
    super(db, { collection: "route_policies" });
  }

  async findEnabledEdgeByParent(parentId: unknown): Promise<RoutePolicyDoc[]> {
    return this.withRetry(async () => {
      const c = await this.coll();
      return c
        .find({ svcconfigId: parentId, enabled: true, type: "Edge" })
        .toArray();
    }, "route_policies.findEdge");
  }

  async findEnabledS2SByParent(parentId: unknown): Promise<RoutePolicyDoc[]> {
    return this.withRetry(async () => {
      const c = await this.coll();
      return c
        .find({ svcconfigId: parentId, enabled: true, type: "S2S" })
        .toArray();
    }, "route_policies.findS2S");
  }
}
