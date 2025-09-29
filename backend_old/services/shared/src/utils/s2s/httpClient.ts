// backend/services/shared/src/utils/s2s/httpClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *
 * Why:
 * - Minimal shared HTTP shim for worker→worker calls.
 * - ⚠️ S2S minting is NOT done here. It is centralized in httpClientBySlug.ts.
 *   This module just performs the HTTP request with whatever headers it’s given.
 *
 * Notes:
 * - Uses global WHATWG fetch (Node ≥18). No Node streams as bodies; only Web-supported types.
 * - Body may be string/Uint8Array/Blob/Web ReadableStream; we don’t re-serialize unless JSON CT.
 * - Strips hop-by-hop headers (e.g., Expect/Connection) that undici/fetch do not support.
 */

export type MintS2SOptions = {
  /** Extra claims to merge into the S2S JWT payload (typed pass-through only). */
  extra?: Record<string, unknown>;
};

export interface S2SRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  /**
   * Body:
   * - Allowed: string | Uint8Array | ArrayBuffer | URLSearchParams | FormData | Blob | ReadableStream (web)
   * - NOT allowed: Node.js Readable streams (will throw UND_ERR_NOT_SUPPORTED via undici/fetch).
   */
  body?:
    | TBody
    | string
    | Uint8Array
    | ArrayBuffer
    | URLSearchParams
    | FormData
    | Blob
    | ReadableStream<any>;
  /** Headers to send (case-preserved). */
  headers?: Record<string, string>;
  /** Request timeout in ms (defaults below). */
  timeoutMs?: number;
  /** Optional end-user assertion to forward (if present). */
  userAssertionJwt?: string;
  /** S2S mint options (typed pass-through only). */
  s2s?: MintS2SOptions;
  /** Optional low-level HTTP toggles (reserved). */
  http?: { http1?: boolean };
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

function sanitizeHeaders(
  input: Record<string, string>
): Record<string, string> {
  // Remove hop-by-hop and unsupported headers for fetch/undici
  const drop = new Set([
    "connection",
    "proxy-connection",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
    "te",
    "expect", // fetch/undici does not support 100-continue here; caused UND_ERR_NOT_SUPPORTED
  ]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();
    if (drop.has(key)) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function s2sRequest<TResp = unknown, TBody = unknown>(
  url: string,
  opts: S2SRequestOptions<TBody> = {}
): Promise<S2SResponse<TResp>> {
  // Effective timeout (ms)
  const effectiveTimeout =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_S2S_TIMEOUT_MS;

  // Build headers (copy-through then sanitize). Do NOT mint Authorization here.
  const rawHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (typeof v === "string") rawHeaders[k] = v;
  }

  // Optionally forward end-user assertion if provided by caller
  if (opts.userAssertionJwt) {
    rawHeaders["X-NV-User-Assertion"] = opts.userAssertionJwt;
  }

  const headers = sanitizeHeaders(rawHeaders);

  const method = (opts.method ?? "GET") as NonNullable<
    S2SRequestOptions["method"]
  >;

  // Prepare body. IMPORTANT:
  // - Never send a body with GET/HEAD.
  // - Only JSON.stringify when caller set a JSON content-type and provided a plain object.
  let body: any | undefined;
  const hasCT = Object.keys(headers).some(
    (k) => k.toLowerCase() === "content-type"
  );

  if (opts.body !== undefined && !["GET", "HEAD"].includes(method)) {
    const ct = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "content-type"
    )?.[1];

    const isString = typeof opts.body === "string";
    const isUint8 =
      typeof Uint8Array !== "undefined" && opts.body instanceof Uint8Array;
    const isArrayBuf =
      typeof ArrayBuffer !== "undefined" && opts.body instanceof ArrayBuffer;
    const isWebStream =
      typeof (globalThis as any).ReadableStream !== "undefined" &&
      opts.body instanceof (globalThis as any).ReadableStream;
    const isBlob =
      typeof (globalThis as any).Blob !== "undefined" &&
      opts.body instanceof (globalThis as any).Blob;
    const isURLSearchParams =
      typeof URLSearchParams !== "undefined" &&
      opts.body instanceof URLSearchParams;
    const isFormData =
      typeof FormData !== "undefined" && opts.body instanceof FormData;

    if (
      isString ||
      isUint8 ||
      isArrayBuf ||
      isWebStream ||
      isBlob ||
      isURLSearchParams ||
      isFormData
    ) {
      body = opts.body as any; // pass-through
    } else if (ct && ct.toLowerCase().startsWith("application/json")) {
      body = JSON.stringify(opts.body as any);
    } else if (!hasCT) {
      // Default to JSON if no CT provided and body is a plain object/array
      const t = typeof opts.body;
      if (t === "object") {
        headers["Content-Type"] = "application/json; charset=utf-8";
        body = JSON.stringify(opts.body as any);
      } else {
        body = String(opts.body);
      }
    } else {
      // Unknown combination; pass through — fetch may still accept it if compatible.
      body = opts.body as any;
    }
  }

  // Timeout/abort wiring: prefer AbortSignal.timeout when available; fallback to manual controller
  let controller: AbortController | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal;
  if (typeof (AbortSignal as any)?.timeout === "function") {
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
