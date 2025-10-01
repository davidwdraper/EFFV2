// backend/shared/src/svc/SvcClient.ts
/**
 * Purpose:
 * - Tiny, swappable S2S client. Does URL resolution via injected resolver.
 * - Returns a uniform envelope; does not throw on non-2xx.
 */

import { randomUUID } from "crypto";
import { SvcCallOptions, SvcResponse, UrlResolver } from "./types";

export class SvcClient {
  constructor(
    private readonly resolveUrl: UrlResolver,
    private readonly defaults: {
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {}
  ) {}

  public async call<T = unknown>(
    opts: SvcCallOptions
  ): Promise<SvcResponse<T>> {
    const method = (opts.method ?? "GET").toUpperCase();
    const version = opts.version ?? 1;
    const requestId = opts.requestId ?? randomUUID();

    const base = await this.resolveUrl(opts.slug, version);
    const url = this.buildUrl(base, opts.path, opts.query);

    const headers: Record<string, string> = {
      "x-request-id": requestId,
      accept: "application/json",
      ...(this.defaults.headers ?? {}),
      ...(opts.headers ?? {}),
    };

    const timeoutMs = opts.timeoutMs ?? this.defaults.timeoutMs ?? 5000;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.prepareHeaders(headers, opts.body),
        body: this.prepareBody(opts.body, method),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(t);
      return {
        ok: false,
        status: 0,
        headers: {},
        error: { code: "network_error", message: String(err) },
        requestId,
      };
    } finally {
      clearTimeout(t);
    }

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k.toLowerCase()] = v));

    const isJson = (res.headers.get("content-type") || "").includes(
      "application/json"
    );
    let payload: any = undefined;
    try {
      payload = isJson ? await res.json() : await res.text();
    } catch {
      // ignore parse errors; payload stays undefined
    }

    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        headers: resHeaders,
        data: payload as T,
        requestId: requestIdFromHeaders(resHeaders) ?? requestId,
      };
    } else {
      const message =
        (payload &&
          typeof payload === "object" &&
          (payload.error?.message || payload.message)) ||
        (typeof payload === "string" ? payload : "upstream_error");
      return {
        ok: false,
        status: res.status,
        headers: resHeaders,
        error: { code: "upstream_error", message },
        requestId: requestIdFromHeaders(resHeaders) ?? requestId,
      };
    }
  }

  private buildUrl(
    base: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    let u = base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    if (query && Object.keys(query).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        qs.append(k, String(v));
      }
      u += "?" + qs.toString();
    }
    return u;
  }

  private prepareHeaders(
    h: Record<string, string>,
    body: unknown
  ): Record<string, string> {
    if (body !== undefined && h["content-type"] == null) {
      h["content-type"] = "application/json";
    }
    return h;
  }

  private prepareBody(body: unknown, method: string): BodyInit | undefined {
    if (method === "GET" || method === "DELETE") return undefined;
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string" || body instanceof Uint8Array)
      return body as any;
    return JSON.stringify(body);
  }
}

function requestIdFromHeaders(h: Record<string, string>): string | undefined {
  return h["x-request-id"] || h["x-correlation-id"] || h["request-id"];
}
