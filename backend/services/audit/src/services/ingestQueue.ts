// backend/services/audit/src/services/ingestQueue.ts
/**
 * In-memory ingest queue with on-demand flushing (no periodic timer).
 *
 * WHY THIS SHAPE
 * --------------
 * - Controller AWAITS WAL append (durability) → enqueue → single-flight flush.
 * - DB failures re-queue the batch and back off briefly; WAL guarantees no loss.
 * - No periodic tick; fewer moving parts. WAL replay is a separate startup task.
 *
 * Write semantics:
 * - INSERT-ONLY. No upserts. Unique(eventId) enforces idempotency.
 */

import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import * as repo from "../repo/auditEventRepo";

// ---- Config (envs asserted at bootstrap per SOP) ----------------------------
const BATCH_MAX = Number(process.env.AUDIT_BATCH_MAX || "500"); // events per DB write
const QUEUE_MAX = Number(process.env.AUDIT_QUEUE_MAX || "50000"); // safety cap
const RETRY_BACKOFF_MS = Number(process.env.AUDIT_RETRY_BACKOFF_MS || "1000"); // on error
const TIME_SLICE_MS = Number(process.env.AUDIT_TIME_SLICE_MS || "25"); // event-loop yield budget

// ---- State ------------------------------------------------------------------
const q: AuditEvent[] = [];
let isFlushing = false;
let retryTimer: NodeJS.Timeout | null = null;

// ---- Public API -------------------------------------------------------------

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

export function getQueueDepth() {
  return {
    length: q.length,
    batchMax: BATCH_MAX,
    isFlushing,
    retryBackoffMs: retryTimer ? RETRY_BACKOFF_MS : 0,
  };
}

export function stopFlusher() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  isFlushing = false;
}

// ---- Internals --------------------------------------------------------------

function requestFlush() {
  if (isFlushing) return;
  if (retryTimer) return; // wait out backoff
  void flushLoop();
}

async function flushLoop(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  const started = Date.now();

  try {
    while (q.length > 0) {
      const take = Math.min(BATCH_MAX, q.length);
      const batch = q.splice(0, take);

      try {
        await repo.insertBatch(batch); // INSERT-ONLY, ignore dupes
      } catch (dbErr) {
        // Put back at FRONT to preserve order
        for (let i = batch.length - 1; i >= 0; i--) q.unshift(batch[i]);

        // eslint-disable-next-line no-console
        console.error(
          `[ingestQueue] DB insert failed (requeued=${batch.length}): ${
            (dbErr as Error).message
          }`
        );

        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            requestFlush();
          }, RETRY_BACKOFF_MS);
        }
        return; // exit; retry after backoff
      }

      // Yield if we’ve hogged the loop too long
      if (Date.now() - started > TIME_SLICE_MS) {
        queueMicrotask(() => {
          isFlushing = false;
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
