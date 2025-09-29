/**
 * NowVibin — Act Service
 * Client: Geo resolution via callBySlug('geo')
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0031-remove-hmac-open-switch.md
 *
 * Why:
 * - All S2S auth is asymmetric (KMS + JWKS). No HS256/HMAC or “open” modes (ADR-0031).
 * - Use the shared callBySlug() so routing, S2S headers, retries, and timeouts are
 *   centrally enforced—zero per-service drift.
 * - Act talks to the Geo service **directly** by slug; no gateway-core hop.
 */

import type { AxiosResponse } from "axios";
import { callBySlug } from "@shared/utils/callBySlug"; // slug→baseURL + S2S injection

/** Input address shape accepted by this helper. */
export type MailingAddress = {
  addr1?: string;
  addr2?: string;
  city?: string;
  state?: string;
  zip?: string;
};

/** Normalized point returned when resolution succeeds. */
export type GeoPoint = { lat: number; lng: number };

/**
 * Resolve a human-readable address to lat/lng using the Geo service.
 *
 * Why:
 * - Keep business logic here tiny; the shared client handles auth, tracing, and
 *   resilience. If Geo is soft-down or returns non-2xx, we degrade gracefully.
 */
export async function resolveMailingAddress(
  addr: MailingAddress
): Promise<GeoPoint | null> {
  const { addr1, city, state, zip } = addr || {};
  if (!addr1 || !city || !state || !zip) return null;

  const addressLine = `${addr1}, ${city}, ${state} ${zip}`.trim();

  // Direct call to the geo service by slug. No gateway-core.
  // Why: single responsibility; internal services communicate service→service
  // via slug mapping and S2S enforced by the shared client (ADR-0030/0031).
  const client = callBySlug("geo", {
    timeout: 2000, // user-path; fail fast to avoid UI stalls
    // headers, requestId propagation, and S2S token are injected inside callBySlug
  });

  let r: AxiosResponse<any>;
  try {
    r = await client.post(
      "/resolve",
      { address: addressLine },
      { validateStatus: () => true }
    );
  } catch {
    // Network/client error → treat as no result (soft-fail; caller can choose fallback)
    return null;
  }

  if (
    r.status >= 200 &&
    r.status < 300 &&
    r.data &&
    typeof r.data.lat === "number" &&
    typeof r.data.lng === "number"
  ) {
    return { lat: r.data.lat, lng: r.data.lng };
  }

  // Non-2xx or malformed response — no throw; upstream may retry with different address.
  return null;
}
