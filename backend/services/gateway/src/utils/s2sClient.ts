// backend/services/gateway/src/utils/s2sClient.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0014-s2s-jwt-verification-for-internal-services.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *
 * Why:
 * - Single axios client for internal S2S hops. Always overwrites Authorization
 *   with a freshly minted S2S token; never forwards user tokens.
 * - Exposes tiny helpers. Added `s2sGet` adapter to match legacy imports.
 */

import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { mintS2S } from "@eff/shared/src/svcconfig/client"; // shared minter (HS256)

/** The ONLY client the gateway may use to call internal workers. */
export const s2sClient = axios.create();

s2sClient.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(cfg.headers);
  // Never forward any user token; always inject fresh S2S
  headers.delete("Authorization");
  const ttlSec = Math.min(
    Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
    900
  );
  headers.set("Authorization", `Bearer ${mintS2S(ttlSec)}`);
  cfg.headers = headers;
  return cfg;
});

/** GET JSON over S2S (validateStatus disabled; check res.status yourself). */
export async function getInternalJson(
  url: string,
  headers?: Record<string, string>
) {
  return s2sClient.get(url, {
    headers: { accept: "application/json", ...(headers || {}) },
    validateStatus: () => true,
    timeout: 5000,
  });
}

/** PUT JSON over S2S (used by audit dispatch). */
export async function putInternalJson<TBody extends object>(
  url: string,
  body: TBody,
  headers?: Record<string, string>
) {
  return s2sClient.put(url, body, {
    headers: { "content-type": "application/json", ...(headers || {}) },
    validateStatus: () => true,
    timeout: 5000,
  });
}

/** Compatibility shim: old code imports `s2sGet` — keep it working. */
export const s2sGet = getInternalJson;
