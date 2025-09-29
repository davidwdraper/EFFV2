/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Security: docs/architecture/shared/SECURITY.md
 * - Scaling: docs/architecture/backend/SCALING.md
 * - ADRs: docs/adr/0001-audit-wal-and-batching.md
 *
 * Why:
 * - Immutable ledger for audit events with idempotent inserts (unique eventId)
 *   and read-friendly indexes for time windows and billing exports.
 */

import { Schema, model, models } from "mongoose";

const AuditEventSchema = new Schema(
  {
    // Identity / idempotency
    eventId: { type: String, required: true, unique: true, index: true },

    // Timing (ISO strings on wire; we keep strings here to match contract)
    tsStart: { type: String }, // optional
    ts: { type: String, required: true }, // finalize time
    durationMs: { type: Number, required: true, min: 0 },
    durationReliable: { type: Boolean },

    // Finalization semantics
    finalizeReason: {
      type: String,
      enum: ["finish", "timeout", "client-abort", "shutdown-replay"],
    },

    // Correlation
    requestId: { type: String, required: true },

    // Caller & auth context
    userSub: { type: String },
    userIssuer: { type: String },
    s2sIssuer: { type: String },
    audience: { type: String },

    // HTTP surface
    method: { type: String, required: true },
    path: { type: String, required: true },
    slug: { type: String, required: true },
    targetBaseUrl: { type: String },
    status: { type: Number, required: true },

    // Network metadata
    ip: { type: String },
    ua: { type: String },
    contentType: { type: String },

    // Sizes & integrity (no raw bodies stored)
    bytesIn: { type: Number, min: 0 },
    bytesOut: { type: Number, min: 0 },
    bodyHash: { type: String },
    respHash: { type: String },

    // Billing identity
    billingAccountId: { type: String },
    billingSubaccountId: { type: String },
    planId: { type: String },

    // Policy/flags
    pii: { type: Boolean },
    billableUnits: { type: Number, min: 0, default: 1 },

    // Stable extras (flat string map)
    meta: { type: Map, of: String },
  },
  {
    collection: "auditEvents",
    bufferCommands: false, // fail fast if not connected (ops clarity)
    versionKey: false, // immutable row; event payload has the times we care about
    strict: true,
  }
);

// ---------- Indexes ----------
AuditEventSchema.index({ ts: -1, _id: -1 }); // time-window scans & cursor paging
AuditEventSchema.index({ billingAccountId: 1, ts: -1 }); // billing exports
AuditEventSchema.index({ slug: 1, ts: -1 }); // service-by-time
AuditEventSchema.index({ requestId: 1 }); // trace lookups
AuditEventSchema.index({ userSub: 1 }); // per-user investigations
// Optionals for later:
// AuditEventSchema.index({ finalizeReason: 1, ts: -1 });
// AuditEventSchema.index({ status: 1, ts: -1 });

const AuditEventModel =
  models.AuditEvent || model("AuditEvent", AuditEventSchema);

export default AuditEventModel;
