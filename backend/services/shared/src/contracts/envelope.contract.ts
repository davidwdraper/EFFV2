// backend/services/shared/src/contracts/envelope.contract.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 *   - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Canonical, never-changing S2S **success** envelope used by all services.
 * - Opaque `data.body` is validated by the endpoint-specific shared contract.
 * - Errors use RFC7807 JSON (NOT enveloped).
 *
 * Invariants:
 * - `ok: true`
 * - `service` == emitting service slug (e.g., "audit", "gateway", "svcfacilitator")
 * - `data.status` is an HTTP status code (100..599)
 * - `data.body` is endpoint-specific (opaque to plumbing)
 * - `x-request-id` is a **header**, not part of the envelope
 */

import { z } from "zod";
import { BaseContract } from "./base.contract";

// Conservative slug check: lowercase letters, digits, hyphens; must start with a letter.
export const ServiceSlug = z.string().regex(/^[a-z][a-z0-9-]*$/, {
  message:
    "service slug must be lowercase alphanumeric with hyphens and start with a letter",
});

// HTTP status: accept 100..599 (allows informational through server errors).
export const HttpStatusCode = z.number().int().min(100).max(599);

/** Generic Envelope type — parameterized by the opaque body type. */
export interface Envelope<TBody> {
  ok: true;
  service: string;
  data: {
    status: number;
    body: TBody;
  };
}

/**
 * EnvelopeContract: class wrapper around the canonical envelope schema & builders.
 * Extends BaseContract to align with the shared contract class pattern.
 */
export class EnvelopeContract<TBody> extends BaseContract<Envelope<TBody>> {
  /** Zod schema factory for an Envelope whose `body` uses the supplied schema. */
  public static schema<T extends z.ZodTypeAny>(bodySchema: T) {
    return z.object({
      ok: z.literal(true),
      service: ServiceSlug,
      data: z.object({
        status: HttpStatusCode,
        body: bodySchema,
      }),
    });
  }

  /** Build a valid success envelope (RouterBase) — throws on bad args. */
  public static makeOk<T>(
    service: string,
    status: number,
    body: T
  ): Envelope<T> {
    if (!/^[a-z][a-z0-9-]*$/.test(service)) {
      throw new Error("EnvelopeContract.makeOk: invalid service slug");
    }
    if (!(Number.isInteger(status) && status >= 100 && status <= 599)) {
      throw new Error("EnvelopeContract.makeOk: invalid HTTP status");
    }
    return { ok: true, service, data: { status, body } };
  }

  /** Validate an unknown payload against the envelope+body schema and return it typed. */
  public static parse<T>(
    payload: unknown,
    bodySchema: z.ZodType<T>
  ): Envelope<T> {
    const schema = EnvelopeContract.schema(bodySchema);
    return schema.parse(payload) as Envelope<T>;
  }

  // BaseContract requirement — envelopes are already JSON-ready.
  public toJSON(): Envelope<TBody> {
    // This class is used in static form; instances are unnecessary.
    // Provided only to satisfy BaseContract’s abstract API.
    throw new Error("EnvelopeContract is static-only; do not instantiate.");
  }
}
