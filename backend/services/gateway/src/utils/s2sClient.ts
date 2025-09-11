// backend/services/gateway/src/utils/s2sClient.ts
//
// References:
// - SOP v4 — “Only gateway client for internal workers; overwrite Authorization with fresh S2S”
// - Security/S2S — gateway mints S2S; never forward user tokens upstream
//
// Why:
// A **single** axios instance for all internal calls. An interceptor injects a fresh
// S2S token on each request so callers don’t have to think about auth. We expose
// tiny helpers (`getInternalJson`, `putInternalJson`) so service code doesn’t deal
// with axios minutiae.
//
// Notes:
// - validateStatus is disabled; callers check status codes explicitly.
// - Timeout is conservative — internal hops should be quick; tune per need.
//

import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { mintS2S } from "@shared/svcconfig/client"; // shared minter; uses S2S_* env

/** The ONLY client the gateway may use to call internal workers. */
export const s2sClient = axios.create();

s2sClient.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(cfg.headers);
  // Never forward any user token; always inject fresh S2S
  headers.delete("Authorization");
  const ttlSec = Math.min(
    Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
    900
  ); // clamp to sane upper bound
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
    headers: {
      accept: "application/json",
      ...(headers || {}),
    },
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
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
    validateStatus: () => true,
    timeout: 5000,
  });
}
