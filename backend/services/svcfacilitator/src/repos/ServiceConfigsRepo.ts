// backend/services/svcfacilitator/src/repos/ServiceConfigsRepo.ts
/**
 * Path: backend/services/svcfacilitator/src/repos/ServiceConfigsRepo.ts
 *
 * Docs / SOP
 * - SOP: Reduced, Clean — single concern repos, env invariance
 * - ADR-0007: SvcConfig Contract (fixed shapes & keys, OO form)
 * - ADR-0020: Mirror & Push (DB → Domain → Mirror)
 *
 * Purpose:
 * - Fetch visible service_config parents and return a raw DTO with the exact keys
 *   the domain factory expects. No coercion; the domain validates loudly.
 *
 * Invariants:
 * - No env reads. No Zod here. No business logic.
 * - Only enabled && !internalOnly parents are returned.
 */

import { RepoBase } from "@nv/shared/base/RepoBase";
import type { DbClient } from "@nv/shared/db/DbClient";
import { getLogger } from "@nv/shared/logger/Logger";

export type ServiceConfigDbDoc = {
  _id: unknown;
  slug: unknown;
  version: unknown;
  enabled: unknown;
  internalOnly: unknown;
  baseUrl: unknown;
  outboundApiPrefix: unknown; // REQUIRED by domain & wire
  exposeHealth: unknown; // REQUIRED by domain & wire
  changedByUserId?: unknown;
  updatedAt: unknown;
};

const FILTER = { enabled: true, internalOnly: false } as const;
const PROJECTION = {
  _id: 1,
  slug: 1,
  version: 1,
  enabled: 1,
  internalOnly: 1,
  baseUrl: 1,
  outboundApiPrefix: 1, // ← required
  exposeHealth: 1, // ← required
  changedByUserId: 1,
  updatedAt: 1,
} as const;

export class ServiceConfigsRepo extends RepoBase<ServiceConfigDbDoc> {
  private readonly log = getLogger().bind({
    service: "svcfacilitator",
    component: "ServiceConfigsRepo",
    url: "/repos/ServiceConfigsRepo",
  });

  constructor(db: DbClient) {
    // FIX: correct collection name (plural)
    super(db, { collection: "service_configs" });
  }

  /**
   * Returns parents that claim enabled:true && internalOnly:false.
   * Values are passed through as-is; domain will validate/normalize.
   */
  async findVisibleParents(): Promise<ServiceConfigDbDoc[]> {
    const col = await this.coll();

    // Minimal pre-find diagnostics (non-spammy)
    const matched = await col.countDocuments(FILTER as any);
    this.log.debug("SVF301 parents_preflight", {
      collection: (col as any).collectionName ?? "service_configs",
      filter: FILTER,
      projection: Object.keys(PROJECTION),
      matchedCount: matched,
    });

    const cursor = col
      .find(FILTER as any, { projection: PROJECTION as any })
      .map(
        (d: any) =>
          ({
            _id: d?._id,
            slug: d?.slug,
            version: d?.version,
            enabled: d?.enabled,
            internalOnly: d?.internalOnly,
            baseUrl: d?.baseUrl,
            outboundApiPrefix: d?.outboundApiPrefix,
            exposeHealth: d?.exposeHealth,
            changedByUserId: d?.changedByUserId,
            updatedAt: d?.updatedAt,
          } as ServiceConfigDbDoc)
      );

    return await cursor.toArray();
  }
}
