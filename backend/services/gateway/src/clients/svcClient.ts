// backend/services/gateway/src/clients/svcClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Provide a singleton SvcClient configured with SvcConfig URL resolver.
 */

import { SvcClient } from "@nv/shared";
import { getSvcConfig } from "../services/svcconfig";

let _client: SvcClient | null = null;

export function getSvcClient(): SvcClient {
  if (_client) return _client;
  _client = new SvcClient((slug, version) =>
    getSvcConfig().getUrlFromSlug(slug, version)
  );
  return _client;
}
