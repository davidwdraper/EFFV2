// backend/services/audit/src/repo/audit.repo.ts
/**
 * Purpose:
 * - Thin façade over the storage adapter implementing IAuditStore.
 * - Keeps controller/worker code stable while allowing swap of store impl.
 *
 * Contract:
 * - Append-only. Exposes only ensureIndexes + insertFinalMany.
 */

import { requireEnv } from "@nv/shared/env";
import { createDbClientFromEnv } from "@nv/shared/db/DbClientBuilder";
import type { IAuditStore, AuditRecordJson } from "./audit.store.types";
import { AuditMongoStore } from "./audit.mongo.store";

export class AuditRepo {
  private readonly store: IAuditStore;

  constructor(store?: IAuditStore) {
    // Default to Mongo store if none injected.
    this.store =
      store ??
      new AuditMongoStore(createDbClientFromEnv({ prefix: "AUDIT" }), {
        dbName: process.env.AUDIT_DB_NAME,
        logger: undefined,
        collectionName: requireEnv("AUDIT_DB_COLLECTION"),
      });
  }

  /** Ensure required indexes on startup. */
  public async ensureIndexes(): Promise<void> {
    await this.store.ensureIndexes();
  }

  /** Append-only bulk insert of finalized records. */
  public async insertFinalMany(records: AuditRecordJson[]): Promise<number> {
    if (!Array.isArray(records) || records.length === 0) return 0;
    return this.store.insertFinalMany(records);
  }
}
