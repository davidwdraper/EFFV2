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
 * - Minimal shared S2S HTTP client for worker→worker calls.
 * - Always mints short-lived S2S and attaches Authorization. Optional user-assertion passthrough.
 *
 * Notes:
 * - Inside shared, use **relative** imports to avoid self-aliasing.
 */

import { mintS2S, type MintS2SOptions } from "./mintS2S";

export interface S2SRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  body?: TBody;
  headers?: Record<string, string>;
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

export async function s2sRequest<TResp = unknown, TBody = unknown>(
  url: string,
  opts: S2SRequestOptions<TBody> = {}
): Promise<S2SResponse<TResp>> {
  const controller = new AbortController();
  const timeout =
    opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : null;

  try {
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${mintS2S(opts.s2s)}`,
    };
    if (opts.userAssertionJwt)
      headers["X-NV-User-Assertion"] = opts.userAssertionJwt;

    let body: BodyInit | undefined;
    if (
      opts.body !== undefined &&
      opts.method &&
      !["GET", "HEAD"].includes(opts.method)
    ) {
      const hasCT = Object.keys(headers).some(
        (k) => k.toLowerCase() === "content-type"
      );
      if (!hasCT) headers["Content-Type"] = "application/json";
      body = headers["Content-Type"]?.startsWith("application/json")
        ? JSON.stringify(opts.body)
        : (opts.body as any);
    }

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
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
    return {
      status: 0,
      ok: false,
      text:
        err?.name === "AbortError"
          ? "timeout"
          : err?.message ?? "request failed",
      headers: {},
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
