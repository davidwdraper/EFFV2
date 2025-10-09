// backend/services/audit/src/workers/audit.flusher.ts
/**
 * Docs:
 * - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Drain WAL entries, pair begin/end by requestId, finalize to AuditRecord, and persist.
 * - Maintains in-memory partials across flushes (begin w/o end, end w/o begin).
 *
 * Env:
 * - AUDIT_WAL_FLUSH_MS (optional); falls back to WAL_FLUSH_MS, else 1000ms.
 */

import { auditWal } from "../wal/audit.wal";
import { AuditRepo } from "../repo/audit.repo";
import { AuditEntryContract } from "@nv/shared/contracts/audit/audit.entry.contract";
import {
  AuditRecordContract,
  type AuditRecordJson,
} from "@nv/shared/contracts/audit/audit.record.contract";
import { getEnv } from "@nv/shared/env";

type BeginMap = Map<string, AuditEntryContract>;
type EndMap = Map<string, AuditEntryContract>;

export class AuditWalFlusher {
  private readonly repo: AuditRepo;
  private readonly begins: BeginMap = new Map();
  private readonly ends: EndMap = new Map();
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(repo = new AuditRepo()) {
    const ms =
      parseInt(getEnv("AUDIT_WAL_FLUSH_MS") ?? "", 10) ||
      parseInt(getEnv("WAL_FLUSH_MS") ?? "", 10) ||
      1000;
    this.intervalMs = ms;
    this.repo = repo;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flushOnce();
    }, this.intervalMs);
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Single drain + persist cycle. */
  public async flushOnce(): Promise<void> {
    await auditWal.flush(async (batch) => {
      const records: AuditRecordJson[] = [];

      for (const raw of batch) {
        let entry: AuditEntryContract;
        try {
          entry = AuditEntryContract.parse(raw, "WALEntry");
        } catch {
          // Skip malformed
          continue;
        }

        if (entry.phase === "begin") {
          const maybeEnd = this.ends.get(entry.requestId);
          if (maybeEnd) {
            records.push(
              AuditRecordContract.fromEntries({
                begin: entry,
                end: maybeEnd,
              }).toJSON()
            );
            this.ends.delete(entry.requestId);
          } else {
            this.begins.set(entry.requestId, entry);
          }
        } else {
          const maybeBegin = this.begins.get(entry.requestId);
          if (maybeBegin) {
            records.push(
              AuditRecordContract.fromEntries({
                begin: maybeBegin,
                end: entry,
              }).toJSON()
            );
            this.begins.delete(entry.requestId);
          } else {
            this.ends.set(entry.requestId, entry);
          }
        }
      }

      if (records.length > 0) {
        await this.repo.persistMany(records);
      }
    });
  }
}
