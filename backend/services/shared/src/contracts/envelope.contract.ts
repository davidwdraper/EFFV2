// backend/services/shared/src/contracts/envelope.contract.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 *   - ADR-0007 — SvcConfig Contract (fixed shapes & keys)
 *
 * Purpose:
 * - Canonical, never-changing S2S envelope used by all services.
 * - Opaque `body` is validated by the *endpoint-specific* shared contract.
 * - Client/Receiver MUST import the same body contract; no local variants.
 *
 * Invariants:
 * - `ok` boolean (true for successful envelopes emitted by our routers)
 * - `service` == emitting service slug (e.g., "audit", "gateway", "svcfacilitator")
 * - `data.status` is an HTTP status code (100..599)
 * - `data.body` validated by a caller-supplied Zod schema
 *
 * Notes:
 * - No defaults. No guessing. Fail fast on shape errors.
 * - This file exports *types* and a *schema factory* for generic `body`.
 */

import { z } from "zod";

/** Conservative slug check: lowercase letters, digits, hyphens; must start with a letter. */
export const ServiceSlug = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message:
    "service slug must be lowercase alphanumeric with hyphens and start with a letter",
});

/** HTTP status: accept 100..599 (allows informational through server errors). */
export const HttpStatusCode = z.number().int().min(100).max(599);

/**
 * Generic Envelope type — parameterized by the opaque body type.
 * Use with your endpoint contract, e.g. `Envelope<AuditEntriesRequest>`.
 */
export interface Envelope<TBody> {
  ok: boolean;
  service: string;
  data: {
    status: number;
    body: TBody;
  };
}

/**
 * Zod schema factory for an Envelope whose `body` is validated
 * by the supplied `bodySchema`.
 *
 * Example:
 *   const schema = envelopeSchema(AuditEntriesRequest);
 *   const parsed  = schema.parse(payload) as Envelope<AuditEntriesRequestType>;
 */
export const envelopeSchema = <TBodySchema extends z.ZodTypeAny>(
  bodySchema: TBodySchema
) =>
  z.object({
    ok: z.boolean(),
    service: ServiceSlug,
    data: z.object({
      status: HttpStatusCode,
      body: bodySchema,
    }),
  });

/**
 * Helper: build a valid success envelope (optional sugar for routers).
 * Routers may still use their existing `jsonOk` helpers; this keeps parity.
 */
export function makeOkEnvelope<TBody>(
  service: string,
  status: number,
  body: TBody
): Envelope<TBody> {
  // Lightweight runtime guard; full validation should be done in tests.
  if (!/^[a-z][a-z0-9-]*$/.test(service)) {
    throw new Error("invalid service slug for envelope");
  }
  if (!(Number.isInteger(status) && status >= 100 && status <= 599)) {
    throw new Error("invalid HTTP status for envelope");
  }
  return { ok: true, service, data: { status, body } };
}

/**
 * Helper: validate an unknown payload against an envelope+body schema.
 * Prefer using Zod directly in your controllers/clients; this is convenience glue.
 */
export function parseEnvelope<TBody>(
  payload: unknown,
  bodySchema: z.ZodType<TBody>
): Envelope<TBody> {
  const schema = envelopeSchema(bodySchema);
  return schema.parse(payload) as Envelope<TBody>;
}
