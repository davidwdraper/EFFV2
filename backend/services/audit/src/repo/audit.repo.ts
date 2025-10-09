// backend/services/audit/src/repo/audit.repo.ts
/**
 * Docs:
 * - adr0022-shared-wal-and-db-base (Audit persistence)
 *
 * Purpose:
 * - Minimal Audit repository using shared DbClient (Mongo underneath).
 * - Persists flattened AuditRecord documents (matches AuditRecordContract JSON).
 *
 * Env (names only; values in .env.*):
 *   AUDIT_DB_URI, AUDIT_DB_NAME, AUDIT_DB_COLLECTION
 *
 * Behavior:
 * - Constructor requires AUDIT_DB_COLLECTION and AUDIT DB settings; missing envs throw.
 */

import { createDbClientFromEnv } from "@nv/shared/db/DbClientBuilder";
import { requireEnv } from "@nv/shared/env";
import { RepoBase } from "@nv/shared/base/RepoBase";
import type { AuditRecordJson } from "@nv/shared/contracts/audit/audit.record.contract";
import type { Collection, InsertManyResult, OptionalId } from "mongodb";

export class AuditRepo extends RepoBase<AuditRecordJson> {
  constructor() {
    super(
      createDbClientFromEnv({ prefix: "AUDIT" }), // requires AUDIT_DB_URI / AUDIT_DB_NAME
      { collection: requireEnv("AUDIT_DB_COLLECTION") } // requires collection name
    );
  }

  /** Strongly-typed collection handle. */
  protected async coll(): Promise<Collection<AuditRecordJson>> {
    return (await super.coll()) as unknown as Collection<AuditRecordJson>;
  }

  /** Persist a batch of audit records; returns number inserted. */
  public async persistMany(records: AuditRecordJson[]): Promise<number> {
    if (records.length === 0) return 0;

    const col = await this.coll();
    const docs = records as ReadonlyArray<OptionalId<AuditRecordJson>>;

    const res: InsertManyResult<AuditRecordJson> = await this.withRetry(
      () => col.insertMany(docs),
      "audit.persistMany"
    );

    return Object.keys(res.insertedIds ?? {}).length;
  }

  /** Lightweight readiness check. */
  public async isReady(): Promise<boolean> {
    try {
      const col = await this.coll();
      await this.withRetry(
        () =>
          col.estimatedDocumentCount({
            maxTimeMS: 500,
          }) as unknown as Promise<number>,
        "audit.ready"
      );
      return true;
    } catch {
      return false;
    }
  }
}
