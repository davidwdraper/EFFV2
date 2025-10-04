// backend/services/shared/src/svc/client.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Provide a process-wide SvcClient singleton that encapsulates facilitator-based
 *   URL resolution with a TTL cache. Controllers import only this accessor.
 *
 * Env (read at init):
 * - SVCFACILITATOR_BASE_URL  (required by FacilitatorResolver)
 * - SVC_NAME                 (optional) used for "x-service-name" header
 * - S2S_TIMEOUT_MS           (optional) S2S HTTP timeout; default 5000
 * - SVC_RESOLVE_TTL_MS       (optional) facilitator URL cache TTL; default 300000 (5m)
 * - SVC_RESOLVE_TIMEOUT_MS   (optional) facilitator HTTP timeout; default 3000
 *
 * Notes:
 * - No barrels/shims; import via "@nv/shared/svc/client".
 * - Keep this tiny and deterministic; all edge logging happens in SvcClient.
 */

import { SvcClient } from "./SvcClient";
import { buildFacilitatorResolver } from "./resolution/facilitator.resolver";

let _client: SvcClient | null = null;

/** Get the shared SvcClient (lazy singleton). */
export function getSvcClient(): SvcClient {
  if (_client) return _client;

  // Facilitator-backed resolver (throws early if SVCFACILITATOR_BASE_URL is missing)
  const resolver = buildFacilitatorResolver();

  _client = new SvcClient(resolver, {
    timeoutMs: Number(process.env.S2S_TIMEOUT_MS || 5000),
    headers: {
      // keep header present but don’t send empty strings
      ...(process.env.SVC_NAME && process.env.SVC_NAME.trim()
        ? { "x-service-name": process.env.SVC_NAME.trim() }
        : {}),
      accept: "application/json",
    },
  });

  return _client;
}

/** Test helper: reset the singleton (do not use in production). */
export function __resetSvcClientForTests(): void {
  _client = null;
}
