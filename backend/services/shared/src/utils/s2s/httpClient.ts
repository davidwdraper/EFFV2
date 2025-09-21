// PATH: backend/services/shared/src/utils/s2s/httpClient.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Minimal shared S2S HTTP client for worker→worker calls.
 * - Always mints short-lived S2S and attaches Authorization. Optional user-assertion passthrough.
 *
 * Notes:
 * - Inside shared, use **relative** imports to avoid self-aliasing.
 */

import { mintS2S, type MintS2SOptions } from "./mintS2S";

export interface S2SRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  body?: TBody; // may already be a string from callBySlug
  headers?: Record<string, string>; // may already include Content-Length
  timeoutMs?: number;
  userAssertionJwt?: string;
  s2s?: MintS2SOptions;
}

export interface S2SResponse<T> {
  status: number;
  ok: boolean;
  data?: T;
  text?: string;
  headers: Record<string, string>;
}

/** Default intra-service timeout; keep this < gateway edge timeout. */
const DEFAULT_S2S_TIMEOUT_MS = Number(
  process.env.TIMEOUT_S2S_DEFAULT_MS ?? 6000
);

export async function s2sRequest<TResp = unknown, TBody = unknown>(
  url: string,
  opts: S2SRequestOptions<TBody> = {}
): Promise<S2SResponse<TResp>> {
  // Effective timeout (ms)
  const effectiveTimeout =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_S2S_TIMEOUT_MS;

  // Build headers (case-insensitive merge), mint S2S, optionally attach end-user assertion
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (typeof v === "string") headers[k] = v;
  }
  headers["Authorization"] = `Bearer ${mintS2S(opts.s2s)}`;
  if (opts.userAssertionJwt) {
    headers["X-NV-User-Assertion"] = opts.userAssertionJwt;
  }

  const method = opts.method ?? "GET";

  // Prepare body. IMPORTANT: if body is already a string/Buffer/Uint8Array,
  // DO NOT JSON.stringify again. That causes Content-Length mismatches.
  let body: BodyInit | undefined;
  const hasCT = Object.keys(headers).some(
    (k) => k.toLowerCase() === "content-type"
  );
  if (opts.body !== undefined && !["GET", "HEAD"].includes(method)) {
    // Respect existing Content-Type if provided
    if (!hasCT) headers["Content-Type"] = "application/json; charset=utf-8";
    const ct = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "content-type"
    )?.[1];

    const isString = typeof opts.body === "string";
    const isBuffer =
      typeof Buffer !== "undefined" && Buffer.isBuffer(opts.body);
    const isUint8 = opts.body instanceof Uint8Array;

    if (isString || isBuffer || isUint8) {
      // Body already serialized by an upper layer (e.g., callBySlug). Pass through as-is.
      body = opts.body as any;
    } else if (ct && ct.toLowerCase().startsWith("application/json")) {
      // Plain object + JSON CT: serialize once here.
      body = JSON.stringify(opts.body as any);
    } else {
      // Non-JSON content: pass through (caller is responsible for correctness).
      body = opts.body as any;
    }
  }

  // Timeout/abort wiring: prefer AbortSignal.timeout when available; fallback to manual controller
  let controller: AbortController | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal;
  if (typeof (AbortSignal as any)?.timeout === "function") {
    // Node 18.17+ / modern runtimes
    signal = (AbortSignal as any).timeout(effectiveTimeout);
  } else {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller!.abort(), effectiveTimeout);
    signal = controller.signal;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal,
    });

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));

    const raw = await res.text();
    let data: TResp | undefined;
    try {
      data = raw ? (JSON.parse(raw) as TResp) : undefined;
    } catch {
      /* non-JSON; keep raw */
    }

    return {
      status: res.status,
      ok: res.ok,
      data,
      text: data ? undefined : raw,
      headers: resHeaders,
    };
  } catch (err: any) {
    // Distinguish timeout vs other network errors; surface low-level cause
    const isAbort =
      err?.name === "AbortError" ||
      err?.code === "ABORT_ERR" ||
      /timeout/i.test(String(err?.message || ""));
    const cause =
      (err && (err.cause?.code || err.code || err.errno || err.cause?.name)) ||
      undefined;
    const msg = isAbort
      ? "timeout"
      : cause
      ? `network:${cause}`
      : String(err?.message ?? "request failed");

    return {
      status: isAbort ? 504 : 502,
      ok: false,
      text: msg,
      headers: {},
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
