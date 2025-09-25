// /backend/services/shared/src/utils/s2s/s2sAuthHeader.ts
/**
 * S2S auth header builder
 * --------------------------------------------------------------------------
 * Usage:
 *   import { s2sAuthHeader } from "@eff/shared/src/utils/s2s/s2sAuthHeader";
 *   axios.post(url, body, { headers: { ...s2sAuthHeader("act") } })
 *
 * Current behavior:
 *   Reads a static bearer token from env (S2S_BEARER or S2S_TOKEN).
 *
 * Future-ready:
 *   You can later mint short-lived S2S JWTs here (e.g. using mintS2S.ts)
 *   without touching any service code.
 */
export function s2sAuthHeader(_svc: string): Record<string, string> {
  const token =
    process.env.S2S_BEARER && process.env.S2S_BEARER.trim() !== ""
      ? process.env.S2S_BEARER
      : process.env.S2S_TOKEN && process.env.S2S_TOKEN.trim() !== ""
      ? process.env.S2S_TOKEN
      : undefined;

  return token ? { Authorization: `Bearer ${token}` } : {};
}
