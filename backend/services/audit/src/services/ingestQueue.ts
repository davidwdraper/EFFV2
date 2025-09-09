// backend/services/audit/src/services/ingestQueue.ts
/**
 * In-memory ingest queue with on-demand flushing (no periodic timer).
 *
 * WHY THIS SHAPE
 * --------------
 * - Service-side has no need to batch on a fixed cadence. We can:
 *   1) WAL-append in the controller (durability first)
 *   2) Enqueue in memory
 *   3) Immediately trigger a single-flight flush that drains the queue
 * - If the DB write fails, we re-queue the batch and set a SHORT backoff timer.
 *   No steady tick; no extra complexity. WAL covers durability regardless.
 *
 * WHAT THIS IS NOT
 * ----------------
 * - This does not read the WAL. WAL replay is a separate startup task so we
 *   don't compete with live traffic. WAL is our crash/recovery journal, not a hot queue.
 *
 * BILLING/LEGAL
 * -------------
 * - Bulk upsert is idempotent on eventId (unique index) via $setOnInsert.
 *   Retries create no duplicates.
 */

import type { AuditEvent } from "@shared/contracts/auditEvent.contract";
import * as repo from "../repo/auditEventRepo";

// ---- Config (envs asserted at bootstrap per SOP) ----------------------------
const BATCH_MAX = Number(process.env.AUDIT_BATCH_MAX || "500"); // events per DB write
const QUEUE_MAX = Number(process.env.AUDIT_QUEUE_MAX || "50000"); // safety cap
const RETRY_BACKOFF_MS = Number(process.env.AUDIT_RETRY_BACKOFF_MS || "1000"); // only used on error
const TIME_SLICE_MS = Number(process.env.AUDIT_TIME_SLICE_MS || "25"); // yield budget to avoid long event-loop stalls

// ---- State -----------------------------------------------------------------
const q: AuditEvent[] = [];
let isFlushing = false;
let retryTimer: NodeJS.Timeout | null = null;

// ---- Public API ------------------------------------------------------------

/**
 * Enqueue events for background persistence and trigger a flush immediately.
 * Controller has already WAL-appended, so durability is guaranteed even if
 * we were to drop here (we don't, but that's the safety net).
 */
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

/**
 * For readiness endpoints.
 */
export function getQueueDepth() {
  return {
    length: q.length,
    batchMax: BATCH_MAX,
    isFlushing,
    retryBackoffMs: retryTimer ? RETRY_BACKOFF_MS : 0,
  };
}

/**
 * Tests/shutdown helper; cancels any scheduled retry.
 */
export function stopFlusher() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  isFlushing = false;
}

// ---- Internals -------------------------------------------------------------

/**
 * Trigger a flush if none is running and no backoff is in effect.
 * WHY: single-flight writer, immediate persistence, minimal moving parts.
 */
function requestFlush() {
  if (isFlushing) return;
  if (retryTimer) return; // wait for backoff window to expire
  void flushLoop();
}

/**
 * Drain the queue in batches until empty or until we exceed a small time slice,
 * then yield (next tick) to avoid starving the event loop under heavy load.
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
        await repo.upsertBatch(batch); // idempotent on eventId (unique index)
      } catch (dbErr) {
        // Put the batch back at the FRONT to preserve order, then back off briefly.
        for (let i = batch.length - 1; i >= 0; i--) q.unshift(batch[i]);

        // eslint-disable-next-line no-console
        console.error(
          `[ingestQueue] DB upsert failed (requeued=${batch.length}): ${
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
        // Let the event loop breathe; continue on the next tick.
        queueMicrotask(() => {
          isFlushing = false; // allow the next requestFlush() to run
          requestFlush();
        });
        return;
      }
    }
  } catch (err) {
    // Unexpected logic error; do not lose items—items removed from q are only after splice,
    // and all DB errors return batch to the front above.
    // eslint-disable-next-line no-console
    console.error(
      `[ingestQueue] unexpected flush error: ${(err as Error).message}`
    );
  } finally {
    isFlushing = false;
  }
}
