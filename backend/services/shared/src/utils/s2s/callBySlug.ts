#!/usr/bin/env ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md   // APR-0029
 *   - docs/adr/0036-single-s2s-client-kms-only-callBySlug.md   // NEW
 *
 * Why:
 * - Single, version-aware S2S entrypoint used by BOTH:
 *     (a) Gateway (post-guardrails) to call worker services
 *     (b) Service→Service callers
 * - Prevents drift: URL resolution, X-NV-Api-Version stamping, and auth all flow
 *   through the same shared client (`s2sRequestBySlug`).
 *
 * Contract:
 * - External version markers are V-prefixed on the wire ("V1"/"v1"). Internally we
 *   accept "V1", "v1", or "1" and normalize to "V<digit>".
 * - NEVER forward inbound client Authorization. The shared S2S client mints S2S.
 *
 * Notes:
 * - Path may be absolute ("/acts/123") or relative ("acts/123"); both OK.
 * - Body may be string/Buffer/Uint8Array/Readable (NDJSON streaming supported).
 */

import {
  s2sRequestBySlug,
  type S2SResponse,
  type S2SRequestOptions,
} from "../../utils/s2s/httpClientBySlug";
import { logger } from "../../utils/logger";
import type { Readable } from "node:stream";

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
  /** HTTP method; defaults to "GET". */
  method?: string;
  /** Service-local path (with or without leading slash), e.g., "/acts" or "acts/123". */
  path: string;
  /** Optional querystring fragments. Arrays repeat the key. */
  query?: Record<string, unknown>;
  /** Body (JSON, string, Buffer, Uint8Array, or Readable stream for NDJSON). */
  body?: TBody | Readable | string | Buffer | Uint8Array;
  /** Optional headers to forward/add (NEVER include Authorization). */
  headers?: Record<string, string | undefined>;
  /** Optional request timeout (ms). */
  timeoutMs?: number;
  /**
   * Optional extra S2S JWT claims (namespaced) — forwarded to mint layer.
   * Example: { extra: { nv: { purpose: "audit_wal_drain" } } }
   */
  s2s?: { extra?: Record<string, unknown> };
};

/** JSON content-type detection (loose). */
function isJsonContentType(v?: string): boolean {
  return !!v && /^application\/json\b/i.test(v);
}

/**
 * Prepare body & headers:
 * - Accepts string/Buffer/Uint8Array/Readable.
 * - Sets content-length for in-memory bodies; leaves streams lengthless.
 * - Defaults to JSON when body is object/array and no content-type provided.
 * - Disables 100-continue by default (Expect: '') to avoid PUT hangs.
 */
function prepareBodyAndHeaders(
  body: unknown,
  headersIn: Record<string, string | undefined>
): {
  bodyOut?: string | Buffer | Uint8Array | Readable;
  headersOut: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersIn || {})) {
    if (typeof v === "string" && v.length) headers[k.toLowerCase()] = v;
  }

  // Default: disable 100-continue unless caller explicitly set otherwise
  if (headers["expect"] === undefined) headers["expect"] = "";

  if (body == null) return { bodyOut: undefined, headersOut: headers };

  const ct = headers["content-type"];

  // Stream passthrough (NDJSON typical)
  if (typeof (body as any)?.pipe === "function") {
    if (!ct) headers["content-type"] = "application/x-ndjson";
    return { bodyOut: body as any, headersOut: headers };
  }

  // String/Buffer/Uint8Array: set length
  if (
    typeof body === "string" ||
    Buffer.isBuffer(body) ||
    body instanceof Uint8Array
  ) {
    const len =
      typeof body === "string"
        ? Buffer.byteLength(body)
        : Buffer.isBuffer(body)
        ? body.length
        : (body as Uint8Array).byteLength;
    headers["content-length"] = String(len);
    if (!ct && typeof body === "string")
      headers["content-type"] = "application/json; charset=utf-8";
    return { bodyOut: body as any, headersOut: headers };
  }

  // Plain object/array → JSON
  if (!ct || isJsonContentType(ct)) {
    const text = JSON.stringify(body);
    headers["content-type"] = ct || "application/json; charset=utf-8";
    headers["content-length"] = String(Buffer.byteLength(text));
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
    body: bodyOut as any,
    timeoutMs: effectiveTimeoutMs,
    // Forward any extra S2S claims down to the mint layer
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
