// backend/services/audit/src/repo/audit.mongo.store.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *   - adr0024-audit-wal-persistence-guarantee (append-only)
 *
 * Purpose:
 * - Mongo adapter for finalized audit records.
 * - Pure append-only design: inserts only; duplicates are silently ignored.
 *
 * Notes:
 * - Drops legacy `eventId_1` index if present (from deprecated schema).
 * - Deterministic key = requestId (unique).
 * - No updates, no upserts — ever.
 */

import type {
  Document,
  IndexDescription,
  AnyBulkWriteOperation,
  MongoBulkWriteError,
} from "mongodb";
import { RepoBase } from "@nv/shared/base/RepoBase";
import type { DbClient } from "@nv/shared/db/DbClient";
import type { AuditRecordJson, IAuditStore } from "./audit.store.types";

export class AuditMongoStore
  extends RepoBase<AuditRecordJson & Document>
  implements IAuditStore
{
  private readonly collName: string;

  public constructor(
    db: DbClient,
    opts: {
      dbName?: string;
      logger?: RepoBase["logger"];
      collectionName: string;
    }
  ) {
    super(db, {
      collection: opts.collectionName,
      dbName: opts?.dbName,
      logger: opts?.logger,
      retry: { attempts: 3, baseDelayMs: 60, maxDelayMs: 800 },
    });
    this.collName = opts.collectionName;
    (this as any).__isStore = true;
  }

  /** Drop obsolete indexes, then ensure correct ones. Safe & idempotent. */
  public async ensureIndexes(): Promise<void> {
    const col = await this.coll();

    // Drop legacy eventId indexes if found
    try {
      const existing = await col.indexes();
      const toDrop = new Set<string>();

      for (const ix of existing) {
        const ixName = ix.name;
        if (!ixName) continue;

        if (ixName === "eventId_1") toDrop.add(ixName);
        if (ix.key && (ix.key as any).eventId === 1) toDrop.add(ixName);
      }

      for (const name of toDrop) {
        try {
          await col.dropIndex(name);
        } catch {
          /* ignore if already gone */
        }
      }
    } catch {
      /* non-fatal */
    }

    // Ensure required indexes
    const indexes: IndexDescription[] = [
      { key: { requestId: 1 }, unique: true, name: "uq_requestId" },
      { key: { createdAt: -1 }, name: "ix_createdAt_desc" },
    ];
    await super.ensureIndexes(indexes);
  }

  /**
   * Append-only bulk insert of finalized audit records.
   * - Uses unordered bulkWrite (insertOne ops).
   * - Duplicate key errors (E11000) are silently ignored.
   * - Returns number of successfully inserted docs.
   */
  public async insertFinalMany(records: AuditRecordJson[]): Promise<number> {
    if (records.length === 0) return 0;

    const col = await this.coll();
    const ops: AnyBulkWriteOperation<AuditRecordJson>[] = records.map((r) => ({
      insertOne: { document: r },
    }));

    try {
      const res = await this.withRetry(
        () => col.bulkWrite(ops, { ordered: false }),
        "audit.insertFinalMany.bulk"
      );
      return res.insertedCount ?? 0;
    } catch (err: unknown) {
      if (this.isDuplicateKeyError(err)) {
        // Silent duplicate — expected under WAL replay
        return 0;
      }
      throw err;
    }
  }

  /** Helper: detect a Mongo duplicate key error (E11000). */
  private isDuplicateKeyError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as Partial<MongoBulkWriteError>;
    return e.code === 11000 || /E11000/i.test(String(e.message ?? ""));
  }
}
