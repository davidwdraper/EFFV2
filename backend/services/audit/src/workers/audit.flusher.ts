// backend/services/audit/src/workers/audit.flusher.ts
/**
 * Docs:
 * - adr0022-shared-wal-and-db-base
 * - adr0024-audit-wal-persistence-guarantee (append-only)
 *
 * Purpose:
 * - Drain WAL entries, pair begin/end by requestId, finalize, and INSERT (append-only).
 * - Duplicates are silently ignored by the store (unique requestId).
 *
 * Env:
 * - AUDIT_WAL_FLUSH_MS (optional); falls back to WAL_FLUSH_MS, else 1000ms.
 *
 * Notes:
 * - DI only. No singletons. The WAL instance is provided by AuditApp.
 */

import type { Wal, WalEntry } from "@nv/shared/wal/Wal";
import { getEnv } from "@nv/shared/env";
import { AuditEntryContract } from "@nv/shared/contracts/audit/audit.entry.contract";
import {
  AuditRecordContract,
  type AuditRecordJson,
} from "@nv/shared/contracts/audit/audit.record.contract";
import { AuditRepo } from "../repo/audit.repo";

type BeginMap = Map<string, AuditEntryContract>;
type EndMap = Map<string, AuditEntryContract>;

export class AuditWalFlusher {
  private readonly repo: AuditRepo;
  private readonly wal: Wal;
  private readonly begins: BeginMap = new Map();
  private readonly ends: EndMap = new Map();
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(wal: Wal, repo = new AuditRepo()) {
    const ms =
      parseInt(getEnv("AUDIT_WAL_FLUSH_MS") ?? "", 10) ||
      parseInt(getEnv("WAL_FLUSH_MS") ?? "", 10) ||
      1000;
    this.intervalMs = ms;
    this.repo = repo;
    this.wal = wal;
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

  /** Single drain + persist cycle (append-only insert). */
  public async flushOnce(): Promise<void> {
    await this.wal.flush(async (batch: WalEntry[]) => {
      const finals: AuditRecordJson[] = [];

      for (const raw of batch) {
        // 1) If it's an END-ish raw object, normalize BEFORE parse
        let candidate: any = raw as any;
        if (candidate?.phase === "end") {
          const normalized = normalizeEndRaw(candidate);
          if (normalized === null) {
            // cannot normalize legacy end → skip
            continue;
          }
          candidate = normalized;
        }

        // 2) Parse entry; skip malformed
        let entry: AuditEntryContract;
        try {
          entry = AuditEntryContract.parse(candidate, "audit.flusher");
        } catch {
          continue;
        }

        // 3) Pairing with extra normalization when using END from map
        if (entry.phase === "begin") {
          const cachedEnd = this.ends.get(entry.requestId);
          if (cachedEnd) {
            const endNorm = ensureEndNormalized(cachedEnd);
            if (!endNorm) {
              // bad legacy end, keep begin for a future valid end
              this.ends.delete(entry.requestId);
              this.begins.set(entry.requestId, entry);
              continue;
            }
            try {
              finals.push(
                AuditRecordContract.fromEntries({
                  begin: entry,
                  end: endNorm,
                }).toJSON()
              );
            } catch {
              // contract rejection — skip silently
            }
            this.ends.delete(entry.requestId);
          } else {
            this.begins.set(entry.requestId, entry);
          }
        } else {
          // entry.phase === "end" (already normalized pre-parse if legacy)
          const cachedBegin = this.begins.get(entry.requestId);
          if (cachedBegin) {
            try {
              finals.push(
                AuditRecordContract.fromEntries({
                  begin: cachedBegin,
                  end: entry,
                }).toJSON()
              );
            } catch {
              // contract rejection — skip silently
            }
            this.begins.delete(entry.requestId);
          } else {
            this.ends.set(entry.requestId, entry);
          }
        }
      }

      // INSERT ONLY (append-only). Duplicates silently ignored by store.
      if (finals.length > 0) {
        await this.repo.insertFinalMany(finals);
      }
    });
  }
}

/* ----------------------------- helpers ----------------------------- */
/**
 * Normalize a raw END entry (unparsed):
 * - If status missing, infer from http.code/httpCode.
 * - If httpCode missing but http.code present, copy it up.
 * - Remove legacy nested http after normalization.
 * - Returns normalized POJO or null if we can’t normalize.
 */
function normalizeEndRaw(obj: any): any | null {
  if (!obj || obj.phase !== "end") return obj;

  const j: any = { ...obj }; // shallow clone
  const hasStatus = typeof j.status === "string" && j.status.length > 0;

  const code = Number.isFinite(j.httpCode)
    ? Number(j.httpCode)
    : Number.isFinite(j?.http?.code)
    ? Number(j.http.code)
    : undefined;

  if (!hasStatus) {
    if (!Number.isFinite(code)) return null; // cannot infer → skip
    j.status = (code as number) >= 400 ? "error" : "ok";
  }

  if (!Number.isFinite(j.httpCode) && Number.isFinite(code)) {
    j.httpCode = code;
  }

  if (j.http && Number.isFinite(code)) {
    delete j.http; // drop legacy nested field
  }

  return j;
}

/**
 * Ensure an already-parsed END entry is normalized:
 * - entry.toJSON() → normalizeEndRaw → parse again.
 * - Returns normalized entry or null if cannot normalize.
 */
function ensureEndNormalized(
  entry: AuditEntryContract
): AuditEntryContract | null {
  if (entry.phase !== "end") return entry;
  const raw = entry.toJSON() as any;
  const norm = normalizeEndRaw(raw);
  if (norm === null) return null;
  try {
    return AuditEntryContract.parse(norm, "audit.flusher.ensureEndNormalized");
  } catch {
    return null;
  }
}
