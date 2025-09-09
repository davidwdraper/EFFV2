// backend/services/gateway/src/utils/s2sClient.ts
//
// The ONLY HTTP client the external gateway may use for internal worker calls.
// - Injects a fresh S2S JWT on every request (never forwards user tokens)
// - Adds tracing headers (x-request-id, x-s2s-caller=gateway)
// - JSON helpers: GET/PUT (extend as needed)
// - axios usage is confined to THIS file per SOP

import axios, {
  AxiosHeaders,
  type InternalAxiosRequestConfig,
  type AxiosRequestConfig,
} from "axios";
import { randomUUID } from "crypto";
import { mintS2S } from "./s2s";

// ===== Config =====
const DEFAULT_TIMEOUT_MS = toInt(process.env.S2S_HTTP_TIMEOUT_MS, 8000);

function toInt(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : d;
}

// ===== Base client with S2S injection =====
/** The ONLY client the gateway may use to call internal workers. */
export const s2sClient = axios.create();

s2sClient.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(cfg.headers);

  // Never forward any user token; always inject fresh S2S
  headers.delete("Authorization");
  headers.set("Authorization", `Bearer ${mintS2S("gateway")}`);

  // Trace headers (idempotent)
  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", randomUUID());
  }
  headers.set("x-s2s-caller", "gateway");

  // Ensure JSON defaults (callers can override)
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  cfg.headers = headers;
  // Sensible default timeout unless caller overrides
  if (typeof cfg.timeout !== "number") {
    cfg.timeout = DEFAULT_TIMEOUT_MS;
  }

  // We handle non-2xx at call sites
  cfg.validateStatus = () => true;

  return cfg;
});

// ===== Internal helpers (JSON) =====
async function requestJson<T = any>(
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
  cfg?: AxiosRequestConfig
): Promise<{ status: number; data: T }> {
  const res = await s2sClient.request<T>({
    method,
    url,
    data: body ?? undefined,
    headers,
    // allow per-call overrides
    timeout: cfg?.timeout ?? DEFAULT_TIMEOUT_MS,
    maxBodyLength: cfg?.maxBodyLength ?? Infinity,
    maxContentLength: cfg?.maxContentLength ?? Infinity,
    // validateStatus set by interceptor
  });
  return { status: res.status, data: res.data };
}

export async function getInternalJson<T = any>(
  url: string,
  headers?: Record<string, string>,
  cfg?: AxiosRequestConfig
) {
  return requestJson<T>("GET", url, undefined, headers, cfg);
}

export async function putInternalJson<T = any>(
  url: string,
  body: unknown,
  headers?: Record<string, string>,
  cfg?: AxiosRequestConfig
) {
  return requestJson<T>("PUT", url, body, headers, cfg);
}

// If/when needed later:
// export async function postInternalJson<T=any>(...) { return requestJson("POST", ...); }
// export async function deleteInternalJson<T=any>(...) { return requestJson("DELETE", ...); }
