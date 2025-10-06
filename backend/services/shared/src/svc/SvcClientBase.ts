// backend/services/shared/src/svc/SvcClientBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Entrypoint vs ServiceBase)
 *   - ADR-0015 (Logger with bind() Context)
 *   - ADR-0006 (Edge Logging — first-class edge())
 *
 * Purpose:
 * - Base class for S2S clients. Centralizes URL building, headers/body prep,
 *   logging, and envelope shaping. Swaps URL via injected resolver.
 */

import { randomUUID } from "crypto";
import { ServiceBase } from "../base/ServiceBase";
import type { SvcCallOptions, SvcResponse, UrlResolver } from "./types";

export abstract class SvcClientBase extends ServiceBase {
  protected readonly resolveUrl: UrlResolver;
  protected readonly defaults: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  };

  protected constructor(
    resolveUrl: UrlResolver,
    defaults: { timeoutMs?: number; headers?: Record<string, string> } = {},
    opts: { service?: string } = {}
  ) {
    super({
      service: opts.service ?? "shared",
      context: { client: "SvcClient" },
    });
    this.resolveUrl = resolveUrl;
    this.defaults = defaults;
  }

  /** Main S2S call — uniform envelope, never throws for non-2xx. */
  public async call<T = unknown>(
    opts: SvcCallOptions
  ): Promise<SvcResponse<T>> {
    const method = (opts.method ?? "GET").toUpperCase();
    const version = opts.version ?? 1;
    const requestId = opts.requestId ?? randomUUID();

    // Resolve base + build final URL first so logging shows the exact target.
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

    const log = this.bindLog({
      slug: opts.slug,
      version,
      url,
      method,
      component: "SvcClient",
    });

    // Edge hit before fetch
    log.edge({ phase: "before_fetch" }, "s2s call");

    let res: Response;
    try {
      res = (await fetch(url, {
        method,
        headers: this.prepareHeaders(headers, opts.body),
        body: this.prepareBody(opts.body, method),
        signal: controller.signal,
      })) as unknown as Response;
    } catch (err) {
      clearTimeout(t);
      log.error({ err: String(err) }, "s2s_exception");
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
      /* ignore parse errors */
    }

    if (res.ok) {
      log.info({ upstreamStatus: res.status }, "s2s_upstream_ok");
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
      log.warn({ upstreamStatus: res.status, message }, "s2s_upstream_error");
      return {
        ok: false,
        status: res.status,
        headers: resHeaders,
        error: { code: "upstream_error", message },
        requestId: requestIdFromHeaders(resHeaders) ?? requestId,
      };
    }
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  protected buildUrl(
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

  protected prepareHeaders(
    h: Record<string, string>,
    body: unknown
  ): Record<string, string> {
    if (body !== undefined && h["content-type"] == null) {
      h["content-type"] = "application/json";
    }
    return h;
  }

  protected prepareBody(body: unknown, method: string): BodyInit | undefined {
    if (method === "GET" || method === "DELETE" || method === "HEAD")
      return undefined;
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string" || body instanceof Uint8Array)
      return body as any;
    return JSON.stringify(body);
  }
}

function requestIdFromHeaders(h: Record<string, string>): string | undefined {
  return h["x-request-id"] || h["x-correlation-id"] || h["request-id"];
}
