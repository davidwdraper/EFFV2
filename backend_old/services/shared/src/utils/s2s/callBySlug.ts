// backend/services/shared/src/utils/s2s/callBySlug.ts
/**
 * NowVibin — Backend Shared
 * File: backend/services/shared/src/utils/s2s/callBySlug.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Why:
 * - Single, version-aware S2S entrypoint used by BOTH:
 *     (a) Gateway (post-guardrails) to call worker services
 *     (b) Service→Service callers
 * - Prevents drift: URL resolution, X-NV-Api-Version stamping, and auth all flow
 *   through the same shared client (`s2sRequestBySlug`).
 *
 * Notes:
 * - Path may be absolute ("/acts/123") or relative ("acts/123"); both OK.
 * - Body must be fetch-compatible types; Node streams are NOT supported here.
 * - Health endpoints are unversioned on workers; version header is telemetry.
 */

import {
  s2sRequestBySlug,
  type S2SResponse,
  type S2SRequestOptions,
} from "./httpClientBySlug";
import { logger } from "../logger";

/** Normalize "V1" | "v1" | "1" → "V1" for consistent header/telemetry. */
function normApiVersion(v: string): string {
  const m = String(v || "")
    .trim()
    .match(/^v?(\d+)$/i);
  if (!m)
    throw new Error(
      `[callBySlug] invalid apiVersion "${v}" (use V1, v2, or 1)`
    );
  return `V${m[1]}`;
}

/** Ensure leading slash for service-local API path. */
function ensureLeading(p: string): string {
  return p.startsWith("/") ? p : `/${p}`;
}

/** Build a querystring: arrays become repeated keys; null/undefined are dropped. */
function buildQuery(q?: Record<string, unknown>): string {
  if (!q) return "";
  const parts: string[] = [];
  for (const [k, rawVal] of Object.entries(q)) {
    if (rawVal == null) continue;
    const key = encodeURIComponent(k);
    if (Array.isArray(rawVal)) {
      for (const v of rawVal)
        if (v != null) parts.push(`${key}=${encodeURIComponent(String(v))}`);
    } else {
      parts.push(`${key}=${encodeURIComponent(String(rawVal))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
function normalizeMethod(m?: string): HttpMethod {
  const u = String(m || "GET").toUpperCase();
  if (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(u))
    return u as HttpMethod;
  throw new Error(`[callBySlug] unsupported HTTP method "${m}"`);
}

export type CallBySlugOpts<TBody = unknown> = {
  method?: string;
  path: string;
  query?: Record<string, unknown>;
  body?:
    | TBody
    | string
    | Uint8Array
    | ArrayBuffer
    | URLSearchParams
    | FormData
    | Blob
    | ReadableStream<any>;
  headers?: Record<string, string | undefined>;
  timeoutMs?: number;
  s2s?: { extra?: Record<string, unknown> };
};

/** JSON content-type detection (loose). */
function isJsonContentType(v?: string): boolean {
  return !!v && /^application\/json\b/i.test(v);
}

/**
 * Prepare body & headers:
 * - Accepts only fetch-compatible bodies (no Node streams).
 * - Sets content-type JSON when serializing plain objects.
 * - DOES NOT set or pass "Expect" header (unsupported by undici/fetch).
 */
function prepareBodyAndHeaders(
  body: unknown,
  headersIn: Record<string, string | undefined>
): {
  bodyOut?:
    | string
    | Uint8Array
    | ArrayBuffer
    | URLSearchParams
    | FormData
    | Blob
    | ReadableStream<any>;
  headersOut: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersIn || {})) {
    if (typeof v === "string" && v.length) headers[k] = v;
  }

  if (body == null) return { bodyOut: undefined, headersOut: headers };

  const ctKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === "content-type"
  );
  const ct = ctKey ? headers[ctKey] : undefined;

  // Strings and binary-like types are pass-through
  if (
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof (globalThis as any).ReadableStream !== "undefined" &&
      body instanceof (globalThis as any).ReadableStream)
  ) {
    return { bodyOut: body as any, headersOut: headers };
  }

  // Plain object/array → JSON
  if (!ct || isJsonContentType(ct)) {
    const text = JSON.stringify(body);
    headers[ctKey || "Content-Type"] = ct || "application/json; charset=utf-8";
    return { bodyOut: text, headersOut: headers };
  }

  throw new Error(
    `[callBySlug] non-string body provided with non-JSON Content-Type "${ct}"`
  );
}

/** Default S2S timeout (ms). Keep under any edge timeouts to fail caller-first. */
const DEFAULT_S2S_TIMEOUT_MS = Number(
  process.env.TIMEOUT_S2S_DEFAULT_MS ?? 6000
);

/**
 * One-shot, version-aware S2S call by slug.
 * - Gateway usage: pass inbound body/headers minus Authorization.
 * - Service usage: construct your own body/headers.
 */
export async function callBySlug<TResp = unknown, TBody = unknown>(
  slug: string,
  apiVersion: string,
  opts: CallBySlugOpts<TBody>
): Promise<S2SResponse<TResp>> {
  const ver = normApiVersion(apiVersion);
  const method = normalizeMethod(opts.method);
  const qs = buildQuery(opts.query);
  const pathWithQs = `${ensureLeading(opts.path)}${qs}`;

  // Strip any Authorization (never forward edge/user tokens)
  const {
    Authorization: _A,
    authorization: _a,
    ...restHeaders
  } = opts.headers || {};
  const { bodyOut, headersOut } = prepareBodyAndHeaders(opts.body, restHeaders);

  // Stamp API version if caller didn’t set it
  headersOut["x-nv-api-version"] = headersOut["x-nv-api-version"] || ver;

  const effectiveTimeoutMs =
    typeof opts.timeoutMs === "number"
      ? opts.timeoutMs
      : DEFAULT_S2S_TIMEOUT_MS;

  const reqOpts: S2SRequestOptions<any> = {
    method,
    headers: headersOut,
    body: method === "GET" || method === "HEAD" ? undefined : (bodyOut as any),
    timeoutMs: effectiveTimeoutMs,
    s2s: opts.s2s,
  };

  try {
    return await s2sRequestBySlug<TResp, any>(slug, ver, pathWithQs, reqOpts);
  } catch (err) {
    logger.error(
      { slug, apiVersion: ver, method, path: opts.path, err },
      "[callBySlug] S2S request failed"
    );
    throw err;
  }
}
