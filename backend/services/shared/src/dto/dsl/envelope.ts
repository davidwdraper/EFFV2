// backend/services/shared/src/dto/dsl/envelope.ts
/**
 * Docs:
 * - SOP: Canonical DTO bodies are data-only; meta is opt-in and never persisted.
 * - ADRs:
 *   - ADR-0089 (Meta Envelope Wire Safety)
 *   - ADR-0090 (Inbound Handling: tolerate { data, meta } without breaking)
 *
 * Purpose:
 * - Provide a tiny helper that unwraps an inbound meta envelope.
 * - This is an EDGE concern: DTO.fromBody() and controller body parsing may call it.
 * - Must be safe for non-JSON bodies (ADR-0069): only unwraps when shape matches.
 */

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * If body is { data, meta }, return data.
 * Otherwise return body unchanged.
 */
export function unwrapMetaEnvelope(body: unknown): unknown {
  if (!isRecord(body)) return body;

  // Must have "data" key to qualify. We do not require meta presence.
  if (!("data" in body)) return body;

  const data = (body as AnyRecord).data;

  // Only unwrap when data exists (even if null). If absent, treat as non-envelope.
  if (data === undefined) return body;

  return data;
}
