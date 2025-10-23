// backend/services/svcfacilitator/src/repos/ServiceConfigRepo.v2.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0022 — Shared WAL & DB Base (RepoBase)
 *
 * Purpose:
 * - Brand-new v2 repository for `service_configs` (read-focused for mirror/resolve).
 * - Single concern: Mongo access + normalization via shared OO contract.
 *
 * Invariants:
 * - No environment reads here; caller provides DbClient and logger.
 * - Returns **normalized docs only** (via ServiceConfigRecord.toJSON()).
 * - Enabled-only helper for mirror/resolve path.
 *
 * Notes:
 * - Indexes:
 *   • { slug: 1, version: 1 } (unique)
 *   • { slug: 1, version: 1, enabled: 1 } (read filter)
 */

import type { WithId, Document, IndexDescription } from "mongodb";
import type { DbClient } from "@nv/shared/db/DbClient";
import { RepoBase } from "@nv/shared/base/RepoBase";
import {
  ServiceConfigRecord,
  type ServiceConfigRecordJSON,
} from "@nv/shared/contracts/svcconfig.contract";

/** Loose Mongo shape (we normalize through the OO contract). */
type ServiceConfigMongo = WithId<Document>;

/** Public normalized doc type this repo returns. */
export type ServiceConfigDocV2 = ServiceConfigRecordJSON;

export interface ServiceConfigRepoOptions {
  /** Optional db name override (else DbClient default). */
  dbName?: string;
}

export class ServiceConfigRepoV2 extends RepoBase<ServiceConfigMongo> {
  constructor(db: DbClient, opts?: ServiceConfigRepoOptions) {
    super(db, {
      collection: "service_configs",
      dbName: opts?.dbName,
    });
    void this.ensureIndexes(this.indexes());
  }

  /** Index plan for typical resolve/mirror lookups. */
  private indexes(): IndexDescription[] {
    return [
      {
        key: { slug: 1, version: 1 },
        unique: true,
        name: "slug_version_unique",
      },
      {
        key: { slug: 1, version: 1, enabled: 1 },
        name: "slug_version_enabled",
      },
    ];
  }

  /**
   * Fetch a single **enabled** service config by slug@version.
   * Returns a fully **normalized** document (contract JSON).
   */
  public async findEnabledBySlugVersion(
    slug: string,
    version: number
  ): Promise<ServiceConfigDocV2 | null> {
    const doc = await this.withRetry(async () => {
      const c = await this.coll();
      // Only project fields the contract cares about for the mirror path.
      return c.findOne(
        { slug, version, enabled: true },
        {
          projection: {
            _id: 1,
            slug: 1,
            version: 1,
            enabled: 1,
            internalOnly: 1,
            baseUrl: 1,
            outboundApiPrefix: 1,
            exposeHealth: 1,
            updatedAt: 1,
            updatedBy: 1,
            notes: 1,
            port: 1,
          },
        }
      );
    }, "service_configs.findEnabledBySlugVersion");

    if (!doc) return null;

    // Normalize strictly through the OO contract (preserves _id verbatim; validates all fields).
    const normalized = new ServiceConfigRecord({
      ...doc,
      // Ensure updatedAt is an ISO string acceptable by the contract:
      // If the stored value is a Date or {$date}, the contract handles it via normalizeUpdatedAt().
      updatedAt: (doc as any).updatedAt ?? new Date().toISOString(),
    }).toJSON();

    return normalized;
    // Callers that need the canonical mirror key can compute it via ServiceConfigRecord.svcKey() helper if desired.
  }
}
