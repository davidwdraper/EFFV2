// backend/services/shared/src/svc/s2s/contract.guards.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 * - Related:
 *   - contracts/envelope.contract.ts (canonical envelope)
 *
 * Purpose:
 * - One tiny place that enforces the **shared** S2S contract for both ends:
 *   (A) Client-side: validate RESPONSE envelope and unwrap the opaque body.
 *   (B) Receiver-side: validate REQUEST body and build RESPONSE envelope.
 *
 * Invariants:
 * - Requests are **flat bodies** validated by endpoint body schema.
 * - Responses are **RouterBase envelopes** with `data.body` validated by the same schema.
 * - No local variants; both sides import the same shared schema.
 */

import { z } from "zod";
import {
  Envelope,
  envelopeSchema,
  makeOkEnvelope,
} from "../../contracts/envelope.contract";

/** Client-side: validate a RESPONSE envelope and return typed body. */
export function parseResponseEnvelope<TBody>(
  payload: unknown,
  bodySchema: z.ZodType<TBody>
): { envelope: Envelope<TBody>; body: TBody } {
  const schema = envelopeSchema(bodySchema);
  const envelope = schema.parse(payload) as Envelope<TBody>;
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
  return makeOkEnvelope(serviceSlug, status, body);
}
