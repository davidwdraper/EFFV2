// backend/services/audit/src/bootstrap/audit.builders.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0013, ADR-0014, ADR-0022, ADR-0024, adr0023
 *
 * Purpose:
 * - Single-responsibility builders used by AuditApp (orchestrator-only).
 * - Centralizes construction of WAL, Repo, and WalReplayer.
 *
 * Behavior:
 * - WAL replayer pairs begin/end across batches and inserts FINAL records (append-only).
 * - Normalizes legacy END entries that only carried http.code (infers status/httpCode)
 *   both BEFORE parse and when pairing any END pulled from the in-memory map.
 */

import { Wal } from "@nv/shared/wal/Wal";
import { WalReplayer } from "@nv/shared/wal/WalReplayer";
import { createDbClientFromEnv } from "@nv/shared/db/DbClientBuilder";
import type { IBoundLogger } from "@nv/shared/logger/Logger";
import { AuditRepo } from "../repo/audit.repo";
import { AuditMongoStore } from "../repo/audit.mongo.store";

import { AuditEntryContract } from "@nv/shared/contracts/audit/audit.entry.contract";
import {
  AuditRecordContract,
  type AuditRecordJson,
} from "@nv/shared/contracts/audit/audit.record.contract";

const SERVICE = "audit";
type Dict = Record<string, unknown>;

/* ------------------------------ env helpers ------------------------------ */

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "")
    throw new Error(`[${SERVICE}] missing env: ${name}`);
  return v;
}
function intEnv(name: string): number {
  const n = Number(mustEnv(name));
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`[${SERVICE}] env ${name} must be a positive number`);
  return n;
}

/* ----------------------------- build helpers ----------------------------- */

export function buildWal(bindLog: (ctx: Dict) => IBoundLogger): Wal {
  return Wal.fromEnv({
    logger: bindLog({ component: "AuditWAL" }),
    defaults: {
      flushIntervalMs: 0, // cadence controlled by flusher/replayer
      maxInMemory: 1000,
    },
  });
}

/** Driver-agnostic repo (current store: Mongo append-only). */
export function buildAuditRepo(
  bindLog: (ctx: Dict) => IBoundLogger
): AuditRepo {
  const dbClient = createDbClientFromEnv({ prefix: "AUDIT" });
  const collectionName = mustEnv("AUDIT_DB_COLLECTION");

  const store = new AuditMongoStore(dbClient, {
    dbName: process.env.AUDIT_DB_NAME,
    logger: bindLog({ component: "AuditMongoStore" }),
    collectionName,
  });

  const repo = new AuditRepo(store);
  void repo.ensureIndexes().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[audit] repo index bootstrap failed:", String(err));
  });
  return repo;
}

/* ----------------------------- normalization ----------------------------- */

/**
 * Normalize a raw END entry (unparsed):
 * - If status missing, infer from http.code/httpCode.
 * - If httpCode missing but http.code present, copy it up.
 * - Remove legacy nested http after normalization.
 * - Returns a normalized POJO suitable for AuditEntryContract.parse, or null if we can’t normalize.
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
 * Ensure an already-parsed END entry is normalized.
 * - Works from entry.toJSON() → normalizeEndRaw → parse again.
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
    return AuditEntryContract.parse(norm, "audit.replay.ensureEndNormalized");
  } catch {
    return null;
  }
}

/* ----------------------------- replayer build ---------------------------- */

export function buildWalReplayer(
  bindLog: (ctx: Dict) => IBoundLogger,
  repo: AuditRepo
): WalReplayer {
  const log = bindLog({ component: "WalReplayer" });

  // Cross-batch pairing state (in closure)
  const begins = new Map<string, AuditEntryContract>();
  const ends = new Map<string, AuditEntryContract>();

  return new WalReplayer({
    walDir: mustEnv("WAL_DIR"),
    cursorPath: mustEnv("WAL_CURSOR_FILE"),
    batchLines: intEnv("WAL_REPLAY_BATCH_LINES"),
    batchBytes: intEnv("WAL_REPLAY_BATCH_BYTES"),
    tickMs: intEnv("WAL_REPLAY_TICK_MS"),
    logger: log,
    onBatch: async (lines: string[]) => {
      const finals: AuditRecordJson[] = [];

      for (const l of lines) {
        // 1) JSON parse
        let obj: unknown;
        try {
          obj = JSON.parse(l);
        } catch {
          continue; // skip non-JSON junk
        }

        // 2) If it looks like END, normalize BEFORE parse
        let candidate = obj as any;
        if ((candidate?.phase as string) === "end") {
          const normalized = normalizeEndRaw(candidate);
          if (normalized === null) continue; // can't normalize → skip
          candidate = normalized;
        }

        // 3) Parse entry
        let entry: AuditEntryContract;
        try {
          entry = AuditEntryContract.parse(candidate, "audit.replay");
        } catch {
          continue; // malformed after normalization → skip
        }

        // 4) Pairing logic with extra normalization when using END from map
        if (entry.phase === "begin") {
          const cachedEnd = ends.get(entry.requestId);
          if (cachedEnd) {
            const endNorm = ensureEndNormalized(cachedEnd);
            if (!endNorm) {
              // Bad legacy end; keep the begin for a future valid end
              ends.delete(entry.requestId);
              begins.set(entry.requestId, entry);
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
              // If even normalized pair fails contract, skip silently
            }
            ends.delete(entry.requestId);
          } else {
            begins.set(entry.requestId, entry);
          }
        } else {
          // entry.phase === "end" (already normalized before parse)
          const cachedBegin = begins.get(entry.requestId);
          if (cachedBegin) {
            try {
              finals.push(
                AuditRecordContract.fromEntries({
                  begin: cachedBegin,
                  end: entry,
                }).toJSON()
              );
            } catch {
              // Contract reject → skip silently
            }
            begins.delete(entry.requestId);
          } else {
            ends.set(entry.requestId, entry);
          }
        }
      }

      if (finals.length > 0) {
        await repo.insertFinalMany(finals); // append-only; duplicates silently ignored
      }
    },
  });
}
