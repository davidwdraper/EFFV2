// backend/shared/src/svc/SvcClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache)
 *
 * Purpose:
 * - Tiny, swappable S2S client.
 * - If a UrlResolver is injected (e.g., Gateway), use it.
 * - Otherwise, resolve (slug, version) via svcfacilitator using the dedicated helper
 *   with a per-process TTL cache.
 * - Returns a uniform envelope; does not throw on non-2xx.
 *
 * Env (fail-fast where appropriate):
 * - SVC_NAME                      (required to set x-service-name if not provided at call site)
 * - SVCFACILITATOR_BASE_URL       (required if no resolver is injected)
 * - SVC_RESOLVE_PATH              (default: /api/svcfacilitator/resolve)  [used by facilitator helper]
 * - SVC_RESOLVE_TTL_MS            (default: 300000 = 5min)                [used by facilitator helper]
 * - SVC_RESOLVE_TIMEOUT_MS        (default: 3000ms)                       [used by facilitator helper]
 */

import { randomUUID } from "crypto";
import { SvcCallOptions, SvcResponse, UrlResolver } from "./types";
import { buildFacilitatorResolver } from "./resolution/facilitator.resolver";

export class SvcClient {
  // Optional external resolver (gateway can supply its own).
  private readonly injectedResolver?: UrlResolver;
  // Lazily created facilitator-backed resolver when one isn't injected.
  private lazyResolver?: UrlResolver;

  constructor(
    resolveUrl?: UrlResolver,
    private readonly defaults: {
      timeoutMs?: number;
      headers?: Record<string, string>;
    } = {}
  ) {
    this.injectedResolver = resolveUrl;
  }

  public async call<T = unknown>(
    opts: SvcCallOptions
  ): Promise<SvcResponse<T>> {
    const method = (opts.method ?? "GET").toUpperCase();
    const version = opts.version ?? 1;
    const requestId = opts.requestId ?? randomUUID();

    // Resolve base URL
    let base: string;
    try {
      const resolver = this.injectedResolver ?? this.getFacilitatorResolver();
      base = await resolver(opts.slug, version);
    } catch (err) {
      return {
        ok: false,
        status: 0,
        headers: {},
        error: {
          code: "resolve_error",
          message: `failed to resolve '${opts.slug}@v${version}': ${String(
            err
          )}`,
        },
        requestId,
      };
    }

    const url = this.buildUrl(base, opts.path, opts.query);

    // Ensure x-service-name header is present (prefer explicit → defaults → env)
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-request-id": requestId,
      ...(this.defaults.headers ?? {}),
      ...(opts.headers ?? {}),
    };
    if (!hasHeader(headers, "x-service-name")) {
      const svcName = getSvcName();
      if (!svcName) {
        return {
          ok: false,
          status: 0,
          headers: {},
          error: {
            code: "config_error",
            message: "SVC_NAME is required but not set",
          },
          requestId,
        };
      }
      headers["x-service-name"] = svcName;
    }

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

  // ============================== Resolver wiring ===============================

  /** Lazily create a facilitator-backed resolver if none was injected. */
  private getFacilitatorResolver(): UrlResolver {
    if (this.lazyResolver) return this.lazyResolver;

    // Fail fast if env missing — helper will also validate base URL.
    // We do not pass options; helper reads env (SVCFACILITATOR_BASE_URL, TTL, etc.).
    this.lazyResolver = buildFacilitatorResolver();
    return this.lazyResolver;
  }

  // ============================== Helpers =======================================

  private buildUrl(
    base: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    let u = stripTrailingSlash(base) + "/" + stripLeadingSlash(path);
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

// ============================== Local utilities ==================================

function requestIdFromHeaders(h: Record<string, string>): string | undefined {
  return h["x-request-id"] || h["x-correlation-id"] || h["request-id"];
}

function hasHeader(h: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(h).some((k) => k.toLowerCase() === lower);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
function stripLeadingSlash(s: string): string {
  return s.replace(/^\/+/, "");
}

function getSvcName(): string | undefined {
  const n = (process.env.SVC_NAME ?? "").trim();
  return n || undefined;
}
