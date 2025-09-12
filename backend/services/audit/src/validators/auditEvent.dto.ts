// backend/services/audit/src/validators/auditEvent.dto.ts
import { z } from "zod";
import { auditEventContract } from "@eff/shared/src/contracts/auditEvent.contract";

/**
 * WHY THIS FILE EXISTS
 * --------------------
 * The Audit service must accept audit events from the gateway in two forms:
 *  - a single event (low traffic / test tools)
 *  - a batch array (normal production, reduces S2S overhead)
 *
 * We keep the wire contract strict and derive DTOs directly from the shared
 * canonical contract. Controllers will parse with this schema and (importantly)
 * wrap in try/catch so we can produce a detailed problem+detail response via
 * global error middleware—without leaking secrets.
 *
 * BILLING/AUDIT GUARANTEES
 * ------------------------
 * - `eventId` is the idempotency key (client-minted at gateway).
 * - `tsStart` and `ts` are ISO strings; durationMs measured at gateway.
 * - `durationReliable` and `finalizeReason` label whether durationMs can be
 *   trusted for analysis; **billing never uses durationMs**.
 *
 * SAFE FIELD ADDITIONS
 * --------------------
 * We only add optional fields to the shared contract; this DTO automatically
 * honors those without ripple edits here.
 */

// Accept either a single event or a non-empty array of events
export const putAuditEventsDto = z.union([
  auditEventContract,
  z.array(auditEventContract).nonempty(),
]);

export type PutAuditEventsDto = z.infer<typeof putAuditEventsDto>;

/**
 * Helper: normalize to array in controllers.
 * WHY: Controllers and services can treat both forms uniformly for WAL append,
 * queueing, and bulk upsert—reducing branching (and bugs).
 */
export function asEventArray(input: PutAuditEventsDto) {
  return Array.isArray(input) ? input : [input];
}
