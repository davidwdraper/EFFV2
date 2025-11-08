// backend/services/shared/src/svc/client.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 * - ADR-0029 — Contract-ID + BodyHandler pipeline (headers, route-selected schema)
 * - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Provide a process-wide SvcClient singleton that encapsulates facilitator-based
 *   URL resolution with a TTL cache. Controllers import only this accessor.
 *
 * Invariants:
 * - Resolver returns a **composed base**: "<base><prefix>/<slug>/v<ver>".
 * - Callers pass **service-local** paths only (e.g., "/entries").
 * - **No silent fallbacks**: required envs must be present & valid; fail-fast if not.
 * - Headers added here are stable metadata only; per-call headers (e.g., X-NV-Contract)
 *   are supplied by the caller.
 */

import { SvcClient } from "./SvcClient";
import { buildFacilitatorResolver } from "./resolution/facilitator.resolver";

let _client: SvcClient | null = null;

/** Strict env read with fail-fast semantics (no defaults). */
function mustGetEnvInt(name: string): number {
  const v = process.env[name];
  if (!v || !v.trim())
    throw new Error(`[SvcClient] required env ${name} missing/empty`);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`[SvcClient] env ${name} must be a positive integer`);
  return n;
}

function mustGetEnvStr(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim())
    throw new Error(`[SvcClient] required env ${name} missing/empty`);
  return v.trim();
}

/** Get the shared SvcClient (lazy singleton). */
export function getSvcClient(): SvcClient {
  if (_client) return _client;

  // Build the resolver once. It must fail-fast internally if its own envs are missing.
  const resolver = buildFacilitatorResolver();

  // Required envs — no defaults (dev == prod behavior).
  const timeoutMs = mustGetEnvInt("S2S_TIMEOUT_MS");
  const svcName = mustGetEnvStr("SVC_NAME");

  _client = new SvcClient(resolver, {
    timeoutMs,
    headers: {
      // Service identity for downstream observability; callers may add more per request.
      "x-service-name": svcName,
      // Stable accept header; body/content-type are set per request by callers.
      accept: "application/json",
    },
  });

  return _client;
}

/** Test helper: reset the singleton (do not use in production). */
export function __resetSvcClientForTests(): void {
  _client = null;
}
