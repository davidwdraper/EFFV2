// backend/services/audit/src/services/ingestQueue.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/services/ingestQueue.ts
 * Service Slug: audit
 *
 * Why:
 *   In-memory ingest queue with single-flight flushing. We WAL-append in the
 *   controller, enqueue here, and immediately attempt a DB flush. If the write
 *   fails, we re-queue the batch and back off briefly.
 *
 * Policy (immutable ledger):
 *   - Inserts only. No upserts. Duplicates are rejected by the unique
 *     { eventId } index and treated as benign (ignored) during bulk insert.
 *
 * References:
 *   SOP: docs/architecture/backend/SOP.md (New-Session SOP v4, Amended)
 *   Design: docs/design/backend/audit/OVERVIEW.md
 *   ADR: docs/adr/0001-audit-wal-and-batching.md
 */

import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import * as repo from "../repo/auditEventRepo";

// ---- Config (envs asserted at bootstrap per SOP) ----------------------------
const BATCH_MAX = Number(process.env.AUDIT_BATCH_MAX || "500"); // events per DB write
const QUEUE_MAX = Number(process.env.AUDIT_QUEUE_MAX || "50000"); // safety cap
const RETRY_BACKOFF_MS = Number(process.env.AUDIT_RETRY_BACKOFF_MS || "1000"); // on error
const TIME_SLICE_MS = Number(process.env.AUDIT_TIME_SLICE_MS || "25"); // yield budget

// ---- State ------------------------------------------------------------------
const q: AuditEvent[] = [];
let isFlushing = false;
let retryTimer: NodeJS.Timeout | null = null;

// ---- Public API -------------------------------------------------------------

/** Enqueue events for background persistence and trigger a flush immediately. */
export function enqueueForFlush(events: AuditEvent[]) {
  if (!events || events.length === 0) return;

  if (q.length >= QUEUE_MAX) {
    // WAL already has the data; operator can rely on replay.
    // eslint-disable-next-line no-console
    console.error(
      `[ingestQueue] queue saturated (len=${q.length}, cap=${QUEUE_MAX}) — relying on WAL replay`
    );
    return;
  }

  for (const e of events) q.push(e);
  requestFlush();
}

/** For readiness endpoints. */
export function getQueueDepth() {
  return {
    length: q.length,
    batchMax: BATCH_MAX,
    isFlushing,
    retryBackoffMs: retryTimer ? RETRY_BACKOFF_MS : 0,
  };
}

/** Tests/shutdown helper; cancels any scheduled retry. */
export function stopFlusher() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  isFlushing = false;
}

// ---- Internals --------------------------------------------------------------

/** Trigger a flush if none is running and no backoff is in effect. */
function requestFlush() {
  if (isFlushing) return;
  if (retryTimer) return; // wait for backoff window to expire
  void flushLoop();
}

/**
 * Drain the queue in batches until empty or we exceed a small time slice,
 * then yield to avoid starving the event loop under heavy load.
 */
async function flushLoop(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  const started = Date.now();

  try {
    while (q.length > 0) {
      const take = Math.min(BATCH_MAX, q.length);
      const batch = q.splice(0, take);

      try {
        // INSERTS ONLY — ignore duplicates by eventId, do not upsert.
        // Implementation detail lives in the repo (insertMany unordered +
        // ignore duplicate key errors).
        await repo.insertBatchIgnoreDuplicates(batch);
      } catch (dbErr) {
        // Put the batch back at the FRONT to preserve order, then back off briefly.
        for (let i = batch.length - 1; i >= 0; i--) q.unshift(batch[i]);

        // eslint-disable-next-line no-console
        console.error(
          `[ingestQueue] DB insert failed (requeued=${batch.length}): ${
            (dbErr as Error).message
          }`
        );

        // Schedule a one-shot retry; no periodic timer.
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            requestFlush();
          }, RETRY_BACKOFF_MS);
        }
        return; // exit early; we'll retry after backoff
      }

      // Yield if we've hogged the loop for too long
      if (Date.now() - started > TIME_SLICE_MS) {
        queueMicrotask(() => {
          isFlushing = false; // allow the next requestFlush() to run
          requestFlush();
        });
        return;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[ingestQueue] unexpected flush error: ${(err as Error).message}`
    );
  } finally {
    isFlushing = false;
  }
}
