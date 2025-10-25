// backend/services/svcfacilitator/src/repos/ServiceConfigsRepo.ts
/**
 * Path: backend/services/svcfacilitator/src/repos/ServiceConfigsRepo.ts
 *
 * Single concern:
 * - Fetch visible service_config parents and shape them into a raw DTO with keys
 *   the domain expects. No coercion; the domain validates loudly.
 */

import { RepoBase } from "@nv/shared/base/RepoBase";
import type { DbClient } from "@nv/shared/db/DbClient";

export type ServiceConfigDbDoc = {
  _id: unknown;
  slug: unknown;
  version: unknown;
  enabled: unknown;
  internalOnly: unknown;
  baseUrl: unknown;
  outboundApiPrefix: unknown;
  exposeHealth: unknown;
  changedByUserId?: unknown;
  updatedAt: unknown;
};

export class ServiceConfigsRepo extends RepoBase<ServiceConfigDbDoc> {
  constructor(db: DbClient) {
    super(db, { collection: "service_config" });
  }

  async findVisibleParents(): Promise<ServiceConfigDbDoc[]> {
    const col = await this.coll();
    const cursor = col
      .find({ enabled: true, internalOnly: false } as any, {
        projection: {
          _id: 1,
          slug: 1,
          version: 1,
          enabled: 1,
          internalOnly: 1,
          baseUrl: 1,
          outboundApiPrefix: 1, // ← added
          exposeHealth: 1, // ← required
          changedByUserId: 1,
          updatedAt: 1,
        } as any,
      })
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
