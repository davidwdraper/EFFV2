// PATH: backend/services/shared/src/utils/s2s/callBySlug.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md   // APR-0029
 *   - docs/adr/00XX-gateway-uses-shared-s2s-client-post-guardrails.md  // INSERT next ADR #
 *
 * Why:
 * - Single, version-aware S2S entrypoint used by BOTH:
 *     (a) Gateway, after guardrails/auth, to call worker services
 *     (b) Service→Service callers
 * - Prevents drift: URL resolution, X-NV-Api-Version stamping, and auth all flow
 *   through the same shared client (`s2sRequestBySlug`).
 *
 * Contract:
 * - External version markers are V-prefixed on the wire ("V1"/"v1"). Internally we
 *   accept "V1", "v1", or "1" for ergonomics; resolution normalizes to "V<digit>".
 * - NEVER forward inbound client Authorization. The shared S2S client mints S2S.
 *
 * Notes:
 * - Path may be absolute ("/acts/123") or relative ("acts/123"); both OK.
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
  if (!m) {
    throw new Error(
      `[callBySlug] invalid apiVersion "${v}" (use V1, v2, or 1)`
    );
  }
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
    if (rawVal === null || rawVal === undefined) continue;
    const key = encodeURIComponent(k);
    if (Array.isArray(rawVal)) {
      for (const v of rawVal) {
        if (v === null || v === undefined) continue;
        parts.push(`${key}=${encodeURIComponent(String(v))}`);
      }
    } else {
      parts.push(`${key}=${encodeURIComponent(String(rawVal))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// The S2S client only accepts these HTTP methods.
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** Ensure that the provided method string is normalized to the allowed HttpMethod union. */
function normalizeMethod(m?: string): HttpMethod {
  const u = String(m || "GET").toUpperCase();
  switch (u) {
    case "GET":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
    case "HEAD":
      return u;
    default:
      throw new Error(`[callBySlug] unsupported HTTP method "${m}"`);
  }
}

export type CallBySlugOpts<TBody = unknown> = {
  /** HTTP method; defaults to "GET". */
  method?: string;
  /** Service-local path (with or without leading slash), e.g., "/acts" or "acts/123". */
  path: string;
  /** Optional querystring fragments. Arrays repeat the key. */
  query?: Record<string, unknown>;
  /** Optional JSON-serializable body; passed through as-is. */
  body?: TBody;
  /** Optional headers to forward/add (NEVER include Authorization). */
  headers?: Record<string, string | undefined>;
  /** Optional request timeout (ms). */
  timeoutMs?: number;
};

/** Detect a JSON content type (loose match, charset optional). */
function isJsonContentType(v?: string): boolean {
  if (!v) return false;
  return /^application\/json\b/i.test(v);
}

/** Prepare body & headers for http client: serialize JSON if needed, set length. */
function prepareBodyAndHeaders(
  body: unknown,
  headersIn: Record<string, string | undefined>
): {
  bodyOut?: string | Buffer | Uint8Array;
  headersOut: Record<string, string>;
} {
  // Clean undefineds to satisfy Record<string,string>
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(headersIn || {})) {
    if (typeof v === "string" && v.length) headers[k.toLowerCase()] = v;
  }

  // If there is no body, pass through
  if (body === undefined || body === null)
    return { bodyOut: undefined, headersOut: headers };

  const ct = headers["content-type"];

  // If caller already provided a string/Buffer/Uint8Array, honor it
  if (
    typeof body === "string" ||
    Buffer.isBuffer(body) ||
    body instanceof Uint8Array
  ) {
    // Set content-length if we can
    try {
      const len =
        typeof body === "string"
          ? Buffer.byteLength(body)
          : Buffer.isBuffer(body)
          ? body.length
          : (body as Uint8Array).byteLength;
      headers["content-length"] = String(len);
    } catch {
      /* length best-effort */
    }
    // Ensure we have a sensible default content-type if missing and body is string
    if (!ct && typeof body === "string") {
      headers["content-type"] = "application/json; charset=utf-8";
    }
    return { bodyOut: body as any, headersOut: headers };
  }

  // JSON-serialize plain objects/arrays when content-type is JSON (or missing)
  if (!ct || isJsonContentType(ct)) {
    const text = JSON.stringify(body);
    headers["content-type"] = ct || "application/json; charset=utf-8";
    headers["content-length"] = String(Buffer.byteLength(text));
    return { bodyOut: text, headersOut: headers };
  }

  // Otherwise, caller said it's not JSON but provided an object → reject loudly
  throw new Error(
    `[callBySlug] non-string body provided with non-JSON Content-Type "${ct}"`
  );
}

/** Default S2S timeout (ms). Keep below gateway edge timeout to fail inside the caller first. */
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

  const { headers = {}, body } = opts;

  // Strip any Authorization keys without tripping noUnusedLocals.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {
    Authorization: _Authorization,
    authorization: _authorization,
    ...restHeaders
  } = headers;

  // Normalize/serialize body and headers (JSON by default)
  const { bodyOut, headersOut } = prepareBodyAndHeaders(body, restHeaders);

  // Stamp normalized API version header if caller didn't set it
  if (!headersOut["x-nv-api-version"]) {
    headersOut["x-nv-api-version"] = ver;
  }

  // Effective timeout: caller override or default
  const effectiveTimeoutMs =
    typeof opts.timeoutMs === "number"
      ? opts.timeoutMs
      : DEFAULT_S2S_TIMEOUT_MS;

  const reqOpts: S2SRequestOptions<any> = {
    method,
    headers: headersOut,
    body: bodyOut,
    timeoutMs: effectiveTimeoutMs,
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
