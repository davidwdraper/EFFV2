/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Security: docs/architecture/shared/SECURITY.md
 * - Scaling: docs/architecture/backend/SCALING.md
 * - ADRs: docs/adr/0001-audit-wal-and-batching.md
 *
 * Why:
 * - Centralized persistence for the AuditEvent ledger:
 *   - Idempotent insert-only writes (bulk upsert on `eventId`)
 *   - Immutable reads for investigations and billing exports
 * - We deliberately do NOT support update/delete to preserve audit credibility.
 */

import { Types } from "mongoose";
import type { AuditEvent } from "@shared/src/contracts/auditEvent.contract";
import AuditEventModel from "../models/auditEvent.model";

// ---------------------------------------------------------------------------
// Write path (idempotent inserts)
// ---------------------------------------------------------------------------

export type UpsertSummary = {
  attempted: number; // events we tried to persist
  upserted: number; // inserted first-time (not previously seen)
  duplicates: number; // already present (no-op by design)
};

/**
 * Bulk upsert a batch of AuditEvents (idempotent on `eventId`).
 *
 * WHY:
 * - Network/WAL gives us at-least-once delivery; this ensures exactly-once effect.
 * - We use `$setOnInsert` ONLY so duplicates never mutate existing rows.
 */
export async function upsertBatch(
  events: AuditEvent[]
): Promise<UpsertSummary> {
  const attempted = Array.isArray(events) ? events.length : 0;
  if (!attempted) return { attempted: 0, upserted: 0, duplicates: 0 };

  // Build idempotent ops
  let ops: Parameters<typeof AuditEventModel.bulkWrite>[0];
  try {
    ops = events.map((e) => ({
      updateOne: {
        filter: { eventId: e.eventId },
        update: { $setOnInsert: e },
        upsert: true,
      },
    }));
  } catch (err) {
    const e = err as Error;
    e.message = `[audit.repo] build bulk ops failed: ${e.message}`;
    throw e;
  }

  // Execute
  try {
    const res: any = await AuditEventModel.bulkWrite(ops, { ordered: false });
    const upserted = Number(res?.upsertedCount || 0);
    return { attempted, upserted, duplicates: attempted - upserted };
  } catch (err) {
    const e = err as Error;
    e.message = `[audit.repo] bulk upsert failed (attempted=${attempted}): ${e.message}`;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Read path (immutable)
// ---------------------------------------------------------------------------

/**
 * Point lookup by `eventId`.
 *
 * WHY:
 * - Investigations often start from a UUID seen in logs/invoices.
 */
export async function getByEventId(
  eventId: string
): Promise<AuditEvent | null> {
  try {
    const doc = await AuditEventModel.findOne({ eventId }).lean().exec();
    return (doc as unknown as AuditEvent) || null;
  } catch (err) {
    const e = err as Error;
    e.message = `[audit.repo] getByEventId(${eventId}) failed: ${e.message}`;
    throw e;
  }
}

export type ListFilters = {
  // Time window (ISO strings). Inclusive bounds.
  fromTs?: string;
  toTs?: string;

  // Common filters
  slug?: string;
  requestId?: string;
  userSub?: string;
  finalizeReason?: "finish" | "timeout" | "client-abort" | "shutdown-replay";
  statusMin?: number; // e.g., 200
  statusMax?: number; // e.g., 399
  durationReliable?: boolean;

  // Billing filters
  billingAccountId?: string;
  billingSubaccountId?: string;

  // Pagination
  limit?: number; // default 100, max 1000
  cursor?: string; // base64 of {"ts":"<iso>","_id":"<hex>"} for sort ts:-1,_id:-1
};

export type ListResult = {
  items: AuditEvent[];
  nextCursor?: string; // present iff there might be more
};

/**
 * List events by time window + filters with cursor pagination.
 *
 * WHY this shape:
 * - Sort `(ts:-1, _id:-1)` gives stable scans on an append-only ledger.
 * - Cursor avoids skip/limit cliffs on large collections.
 * - Filters match typical investigations and billing exports.
 */
export async function listEvents(
  filters: ListFilters = {}
): Promise<ListResult> {
  const {
    fromTs,
    toTs,
    slug,
    requestId,
    userSub,
    finalizeReason,
    statusMin,
    statusMax,
    durationReliable,
    billingAccountId,
    billingSubaccountId,
    limit = 100,
    cursor,
  } = filters;

  const cap = Math.min(Math.max(1, limit), 1000);

  // Build query
  const q: any = {};

  // Time window (inclusive)
  if (fromTs || toTs) {
    q.ts = {};
    if (fromTs) q.ts.$gte = fromTs;
    if (toTs) q.ts.$lte = toTs;
  }

  if (slug) q.slug = slug;
  if (requestId) q.requestId = requestId;
  if (userSub) q.userSub = userSub;
  if (typeof durationReliable === "boolean")
    q.durationReliable = durationReliable;
  if (finalizeReason) q.finalizeReason = finalizeReason;

  if (typeof statusMin === "number" || typeof statusMax === "number") {
    q.status = {};
    if (typeof statusMin === "number") q.status.$gte = statusMin;
    if (typeof statusMax === "number") q.status.$lte = statusMax;
  }

  if (billingAccountId) q.billingAccountId = billingAccountId;
  if (billingSubaccountId) q.billingSubaccountId = billingSubaccountId;

  // Cursor decode for sort (ts:-1, _id:-1)
  if (cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, "base64").toString("utf8")
      );
      const cTs = String(decoded?.ts || "");
      const cId = String(decoded?._id || "");
      if (cTs && cId && Types.ObjectId.isValid(cId)) {
        // ts < cTs OR (ts == cTs AND _id < cId)
        q.$or = [
          { ts: { $lt: cTs } },
          { ts: cTs, _id: { $lt: new Types.ObjectId(cId) } },
        ];
      }
    } catch (err) {
      const e = err as Error;
      e.message = `[audit.repo] bad cursor "${cursor}": ${e.message}`;
      throw e;
    }
  }

  // Execute
  try {
    const docs = await AuditEventModel.find(q)
      .sort({ ts: -1, _id: -1 })
      .limit(cap)
      .lean()
      .exec();

    const items = (docs as unknown as AuditEvent[]) || [];

    // nextCursor if page full
    let nextCursor: string | undefined;
    if (items.length === cap) {
      const last: any = docs[docs.length - 1];
      if (last?.ts && last?._id) {
        nextCursor = Buffer.from(
          JSON.stringify({ ts: last.ts, _id: String(last._id) }),
          "utf8"
        ).toString("base64");
      }
    }

    return { items, nextCursor };
  } catch (err) {
    const e = err as Error;
    e.message = `[audit.repo] listEvents failed: ${e.message}`;
    throw e;
  }
}

/**
 * Convenience: list events for a billing account in a time window.
 * (Thin wrapper over listEvents with the right filters wired.)
 */
export async function listByBillingAccount(params: {
  billingAccountId: string;
  fromTs?: string;
  toTs?: string;
  limit?: number;
  cursor?: string;
}): Promise<ListResult> {
  const { billingAccountId, fromTs, toTs, limit, cursor } = params;
  return listEvents({ billingAccountId, fromTs, toTs, limit, cursor });
}
