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
 * - Inside shared, use **relative** imports to avoid self-aliasing.
 * - Body may be string/Buffer/Uint8Array/Readable; we don’t re-serialize.
 */

export type MintS2SOptions = {
  /**
   * Extra claims to merge into the S2S JWT payload.
   * Example: { nv: { purpose: "audit_wal_drain" } }
   * NOTE: This is carried through S2SRequestOptions for typing only.
   *       httpClient.ts does not mint; httpClientBySlug.ts reads and mints.
   */
  extra?: Record<string, unknown>;
};

export interface S2SRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  /**
   * Body may already be a string/Buffer/Uint8Array/Readable from upper layers.
   * We pass through as-is and do NOT JSON.stringify again.
   */
  body?: TBody | string | Buffer | Uint8Array | import("node:stream").Readable;
  /** Headers to send (case-preserved); may already include Content-Length. */
  headers?: Record<string, string>;
  /** Request timeout in ms (defaults below). */
  timeoutMs?: number;
  /** Optional end-user assertion to forward (if present). */
  userAssertionJwt?: string;
  /**
   * S2S mint options (carried for type compatibility).
   * httpClientBySlug.ts reads this to mint via KMS. This shim ignores it.
   */
  s2s?: MintS2SOptions;
  /** Optional low-level HTTP toggles (reserved for future use). */
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

export async function s2sRequest<TResp = unknown, TBody = unknown>(
  url: string,
  opts: S2SRequestOptions<TBody> = {}
): Promise<S2SResponse<TResp>> {
  // Effective timeout (ms)
  const effectiveTimeout =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_S2S_TIMEOUT_MS;

  // Build headers (copy-through). Do NOT mint Authorization here.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (typeof v === "string") headers[k] = v;
  }

  // Optionally forward end-user assertion if provided by caller
  if (opts.userAssertionJwt) {
    headers["X-NV-User-Assertion"] = opts.userAssertionJwt;
  }

  const method = opts.method ?? "GET";

  // Prepare body. IMPORTANT:
  // If body is already a string/Buffer/Uint8Array/Readable, pass through as-is.
  // Only JSON.stringify when caller set a JSON content-type and provided a plain object.
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
    const isReadable = typeof (opts.body as any)?.pipe === "function"; // Node Readable stream

    if (isString || isBuffer || isUint8 || isReadable) {
      // Body already serialized or is a stream; pass through as-is.
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
