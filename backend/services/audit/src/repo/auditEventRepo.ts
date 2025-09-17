// backend/services/audit/src/repo/auditEventRepo.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/repo/auditEventRepo.ts
 * Service Slug: audit
 *
 * Why:
 *   Centralized persistence for the AuditEvent ledger with INSERT-ONLY semantics.
 *   - Idempotency comes from a unique { eventId } index.
 *   - Duplicate-key errors are benign and ignored.
 *   - No updates, no deletes — immutable ledger.
 *
 * References:
 *   SOP: docs/architecture/backend/SOP.md (New-Session SOP v4, Amended)
 *   Design: docs/design/backend/audit/OVERVIEW.md
 *   ADR: docs/adr/0001-audit-wal-and-batching.md
 */

import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import AuditEventModel from "../models/auditEvent.model"; // ← matches provided model file name
import { Types } from "mongoose";

// ---------------------------------------------------------------------------
// Write path (insert-only, ignore duplicates)
// ---------------------------------------------------------------------------

export type InsertSummary = {
  attempted: number; // events we tried to persist
  inserted: number; // inserted first-time (not previously seen)
  duplicates: number; // already present (ignored)
};

/**
 * Insert a batch of AuditEvents.
 * - Unordered insertMany so independent docs can succeed.
 * - Duplicate-key errors (11000 on eventId) are treated as NO-OP and counted.
 * - Any non-duplicate error bubbles up to the caller.
 */
export async function insertBatchIgnoreDuplicates(
  events: AuditEvent[]
): Promise<InsertSummary> {
  const attempted = Array.isArray(events) ? events.length : 0;
  if (!attempted) return { attempted: 0, inserted: 0, duplicates: 0 };

  try {
    const res = await AuditEventModel.insertMany(events, {
      ordered: false,
      // strict mode already on schema; we rely on upstream validation
    });

    // If insertMany resolves, all inserted; no duplicates were fatal.
    const inserted = Array.isArray(res) ? res.length : attempted;
    const duplicates = attempted - inserted; // typically 0 here
    return { attempted, inserted, duplicates: Math.max(0, duplicates) };
  } catch (err: any) {
    // Mongoose/Mongo bulk write error shape:
    // err.code === 11000 for single dup; bulk has err.writeErrors[i].code === 11000
    // We ignore ONLY duplicate key errors; anything else is rethrown.
    const writeErrors: any[] = Array.isArray(err?.writeErrors)
      ? err.writeErrors
      : [];

    const allDupes =
      writeErrors.length > 0 &&
      writeErrors.every((we) => Number(we?.code) === 11000);

    if (allDupes) {
      const duplicates = writeErrors.length;
      const inserted = attempted - duplicates;
      return {
        attempted,
        inserted: Math.max(0, inserted),
        duplicates: Math.max(0, duplicates),
      };
    }

    // Mixed/other errors → surface to caller so queue requeues/backoffs.
    const e = err as Error;
    e.message = `[audit.repo] insertMany failed (attempted=${attempted}): ${e.message}`;
    throw e;
  }
}

// ---------------------------------------------------------------------------
/** Point lookup by `eventId` (investigations start here often). */
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

// ---------------------------------------------------------------------------
// Read path (immutable, cursor-paginated listing)
// ---------------------------------------------------------------------------

export type ListFilters = {
  // Time window (ISO strings, inclusive)
  fromTs?: string;
  toTs?: string;

  // Common filters
  slug?: string;
  requestId?: string;
  userSub?: string;
  finalizeReason?: "finish" | "timeout" | "client-abort" | "shutdown-replay";
  statusMin?: number;
  statusMax?: number;
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
      const decoded = JSON.parse(Buffer.from(cursor, "utf8").toString());
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

/** Convenience: list events for a billing account in a time window. */
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
