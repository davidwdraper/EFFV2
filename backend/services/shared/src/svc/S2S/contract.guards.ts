// backend/services/shared/src/svc/s2s/contract.guards.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *   - ADR-0030 — ContractBase & idempotent contract identification
 * - Related:
 *   - contracts/envelope.contract.ts (canonical success envelope)
 *
 * Purpose:
 * - Centralized helpers that enforce the shared S2S contract on both ends:
 *   (A) Client-side: validate RESPONSE envelope and unwrap the opaque body.
 *   (B) Receiver-side: validate REQUEST body (flat) and build RESPONSE envelope.
 *
 * Invariants:
 * - Requests are **flat bodies** validated by endpoint body schema.
 * - Responses are **RouterBase envelopes** with `data.body` validated by the same schema.
 * - Errors follow RFC7807 (NOT enveloped).
 * - No local variants; both sides import the same shared schema/class.
 */

import { z } from "zod";
import { Envelope, EnvelopeContract } from "../../contracts/envelope.contract";

/** Client-side: validate a RESPONSE envelope and return typed body. */
export function parseResponseEnvelope<TBody>(
  payload: unknown,
  bodySchema: z.ZodType<TBody>
): { envelope: Envelope<TBody>; body: TBody } {
  const envelope = EnvelopeContract.parse(
    payload,
    bodySchema
  ) as Envelope<TBody>;
  return { envelope, body: envelope.data.body };
}

/** Receiver-side: validate a flat REQUEST body (no envelope on requests). */
export function parseRequestBody<TBody>(
  payload: unknown,
  bodySchema: z.ZodType<TBody>
): TBody {
  return bodySchema.parse(payload);
}

/** Receiver-side: build a success RESPONSE envelope (thin sugar). */
export function okEnvelope<TBody>(
  serviceSlug: string,
  status: number,
  body: TBody
): Envelope<TBody> {
  return EnvelopeContract.makeOk<TBody>(serviceSlug, status, body);
}
