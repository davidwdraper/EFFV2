// backend/services/audit/src/repo/auditEventRepo.ts
/**
 * NowVibin — Backend
 * File: backend/services/audit/src/repo/auditEventRepo.ts
 * Service: audit
 *
 * Why:
 *   Centralized persistence for the AuditEvent ledger with INSERT-ONLY semantics.
 *   - Idempotency via unique { eventId }.
 *   - Duplicate-key (11000) batches are *not errors*; we return counts.
 *   - No updates, no deletes — immutable ledger.
 */

import type { AuditEvent } from "@eff/shared/src/contracts/auditEvent.contract";
import AuditEventModel from "../models/auditEvent.model";
import { Types } from "mongoose";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function num(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** True if this write error object represents a duplicate-key error (11000). */
function isDupErrObj(we: any): boolean {
  const c = num(we?.code) ?? num(we?.err?.code);
  return c === 11000;
}

/** Extract write error objects (driver/mongoose vary on shape). */
function getWriteErrors(err: any): any[] {
  if (Array.isArray(err?.writeErrors)) return err.writeErrors;
  // Some shapes: err.result?.result?.writeErrors
  if (Array.isArray(err?.result?.result?.writeErrors))
    return err.result.result.writeErrors;
  if (Array.isArray(err?.result?.writeErrors)) return err.result.writeErrors;
  return [];
}

/** True if the bulk failure is *only* duplicates. */
function isDupOnlyBulkError(err: any): boolean {
  // Top-level “everything was a dup” case
  if (num(err?.code) === 11000) return true;
  const wes = getWriteErrors(err);
  return wes.length > 0 && wes.every(isDupErrObj);
}

/** Count duplicates from a bulk error (best-effort across shapes). */
function countDupes(err: any): number {
  if (num(err?.code) === 11000) {
    // Best-effort: assume entire batch duped when driver collapses
    const attempted =
      num(err?.result?.result?.nInserted) !== undefined
        ? num(err?.result?.result?.nInserted)!
        : undefined;
    // If we can’t read attempted reliably here, the caller supplies it.
    // We’ll override with caller’s attempted as needed.
  }
  const wes = getWriteErrors(err);
  return (
    wes.filter(isDupErrObj).length || (num(err?.code) === 11000 ? Infinity : 0)
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Write path (insert-only, ignore duplicates)
// ──────────────────────────────────────────────────────────────────────────────

export type InsertSummary = {
  attempted: number;
  inserted: number;
  duplicates: number;
};

export async function insertBatch(
  events: AuditEvent[]
): Promise<InsertSummary> {
  const attempted = Array.isArray(events) ? events.length : 0;
  if (!attempted) return { attempted: 0, inserted: 0, duplicates: 0 };

  try {
    const res = await AuditEventModel.insertMany(events, { ordered: false });
    const inserted = Array.isArray(res) ? res.length : attempted;
    const duplicates = Math.max(0, attempted - inserted);
    return { attempted, inserted: Math.max(0, inserted), duplicates };
  } catch (err: any) {
    if (isDupOnlyBulkError(err)) {
      // When driver throws despite partial success, we can’t perfectly know
      // how many made it; safest is: duplicates = count of dup write errors,
      // inserted = attempted - duplicates (never negative).
      let d = countDupes(err);
      if (!Number.isFinite(d) || d < 0) d = attempted; // fallback if collapsed top-level 11000
      const inserted = Math.max(0, attempted - d);
      return { attempted, inserted, duplicates: Math.max(0, d) };
    }
    const e = err as Error;
    e.message = `[audit.repo] insertMany failed (attempted=${attempted}): ${e.message}`;
    throw e;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Read path (immutable)
// ──────────────────────────────────────────────────────────────────────────────

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
  fromTs?: string;
  toTs?: string;
  slug?: string;
  requestId?: string;
  userSub?: string;
  finalizeReason?: "finish" | "timeout" | "client-abort" | "shutdown-replay";
  statusMin?: number;
  statusMax?: number;
  durationReliable?: boolean;
  billingAccountId?: string;
  billingSubaccountId?: string;
  limit?: number;
  cursor?: string; // base64 of {"ts":"<iso>","_id":"<hex>"} for sort ts:-1,_id:-1
};

export type ListResult = {
  items: AuditEvent[];
  nextCursor?: string;
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

  try {
    const docs = await AuditEventModel.find(q)
      .sort({ ts: -1, _id: -1 })
      .limit(cap)
      .lean()
      .exec();

    const items = (docs as unknown as AuditEvent[]) || [];

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
