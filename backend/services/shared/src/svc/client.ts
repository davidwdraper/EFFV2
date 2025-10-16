// backend/services/shared/src/svc/client.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Provide a process-wide SvcClient singleton that encapsulates facilitator-based
 *   URL resolution with a TTL cache. Controllers import only this accessor.
 *
 * Notes:
 * - Resolver returns a **composed base** ("<base><prefix>/<slug>/v<ver>").
 * - Callers pass only the service-local path (e.g., "/entries").
 */

import { SvcClient } from "./SvcClient";
import { buildFacilitatorResolver } from "./resolution/facilitator.resolver";

let _client: SvcClient | null = null;

/** Get the shared SvcClient (lazy singleton). */
export function getSvcClient(): SvcClient {
  if (_client) return _client;

  // Factory returns (slug, version) => Promise<string> with the composed base.
  const resolver = buildFacilitatorResolver();

  _client = new SvcClient(resolver, {
    timeoutMs: Number(process.env.S2S_TIMEOUT_MS || 5000),
    headers: {
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
