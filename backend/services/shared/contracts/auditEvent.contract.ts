// backend/services/shared/contracts/auditEvent.contract.ts
import { z } from "zod";

/**
 * Canonical wire-level AuditEvent for billing/forensics.
 *
 * WHY these fields exist:
 * - eventId: client-minted UUID (gateway). Enables idempotent writes; retries are no-ops.
 * - tsStart + ts: prove when a request entered vs. when it finalized (finish/timeout/abort).
 * - finalizeReason + durationReliable: auditors can see why durationMs is/ isn't trustworthy.
 * - billingAccountId (+ subaccount/plan): bill-to identity decoupled from end users.
 * - No raw payloads: we store sizes + hashes only.
 *
 * Safe Field Addition SOP:
 * - New fields here are optional → no breaking ripple for services already using the contract.
 */

export const auditEventContract = z.object({
  // Identity / idempotency
  eventId: z.string().min(1), // UUID from gateway (idempotency key)

  // Timing
  tsStart: z.string().datetime().optional(), // ISO when gateway received the request
  ts: z.string().datetime(), // ISO at finalize (finish/timeout/abort)
  durationMs: z.number().int().nonnegative(), // measured at gateway
  durationReliable: z.boolean().optional(), // true only when finalizeReason === "finish"

  // Finalization semantics (why it ended)
  finalizeReason: z
    .enum(["finish", "timeout", "client-abort", "shutdown-replay"])
    .optional(),

  // Correlation
  requestId: z.string().min(1), // x-request-id (propagated end-to-end)

  // Caller & auth context (observability)
  userSub: z.string().optional(), // from X-NV-User-Assertion.sub
  userIssuer: z.string().optional(), // gateway | gateway-core
  s2sIssuer: z.string().optional(), // typically "gateway"
  audience: z.string().optional(), // e.g., internal-users

  // HTTP surface
  method: z.string().min(1),
  path: z.string().min(1), // original URL (sanitized)
  slug: z.string().min(1), // resolved service slug (act, user, geo, etc.)
  targetBaseUrl: z.string().optional(), // resolved worker base URL (optional)
  status: z.number().int(),

  // Network metadata
  ip: z.string().optional(),
  ua: z.string().optional(),
  contentType: z.string().optional(),

  // Sizes & integrity (no raw bodies stored)
  bytesIn: z.number().int().nonnegative().optional(),
  bytesOut: z.number().int().nonnegative().optional(),
  bodyHash: z.string().optional(), // sha256(req body)
  respHash: z.string().optional(), // sha256(resp body), if enabled per route

  // Billing identity (bill-to, not end-user)
  billingAccountId: z.string().optional(), // stable account id from gateway mapping
  billingSubaccountId: z.string().optional(), // optional project/subaccount
  planId: z.string().optional(), // SKU/tier identifier (optional)

  // Policy/flags
  pii: z.boolean().optional(), // gateway classification flag
  billableUnits: z.number().int().nonnegative().default(1), // gateway sets 0/1 per policy

  // Stable extras for forward-compat
  meta: z.record(z.string(), z.string()).optional(),
});

export type AuditEvent = z.infer<typeof auditEventContract>;
