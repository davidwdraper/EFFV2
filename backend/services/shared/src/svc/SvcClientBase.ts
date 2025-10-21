// backend/services/shared/src/svc/SvcClientBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Entrypoint vs ServiceBase)
 *   - ADR-0015 (Logger with bind() Context)
 *   - ADR-0006 (Edge Logging — first-class edge())
 *   - ADR-0028 — HttpAuditWriter over SvcClient (S2S envelope locked)
 *   - ADR-0030 — ContractBase & idempotent contract identification
 *
 * Purpose:
 * - Base class for S2S clients. Centralizes URL building, headers/body prep,
 *   logging, timeout, and **error discipline** (RFC7807 on non-2xx).
 * - URL is swapped via injected resolver returning a **composed base**.
 *
 * Contract (greenfield, fail-fast):
 * - Throws on any non-2xx or network/timeout error.
 * - Returns SvcResponse<T> only for 2xx upstreams (T = parsed JSON/text).
 *
 * Alignment with SvcReceiver:
 * - Success responses are the canonical RouterBase envelope (validated by the caller).
 * - Errors are RFC7807 JSON: { type, title, status, detail } (no envelope).
 */

import { randomUUID } from "crypto";
import { ServiceBase } from "../base/ServiceBase";
import type { SvcCallOptions, SvcResponse, UrlResolver } from "./types";
import { getBearerToken } from "../security/getBearerToken"; // minimal addition

// Public endpoints/slugs (never require S2S token in this sprint)
const PUBLIC_SLUGS = new Set<string>(["jwks", "facilitator"]);

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

  /** Main S2S call — FAIL-FAST: throws on non-2xx or network error. */
  public async call<T = unknown>(
    opts: SvcCallOptions
  ): Promise<SvcResponse<T>> {
    const method = (opts.method ?? "GET").toUpperCase();
    const version = opts.version ?? 1;
    const requestId = opts.requestId ?? randomUUID();

    // Resolve base + build final URL first so logging shows the exact target.
    const base = await this.resolveUrl(opts.slug, version);

    // Guardrail: the composed base **must** include "/<slug>/v<version>"
    const requiredSeg = `/${opts.slug}/v${version}`;
    if (!base.includes(requiredSeg)) {
      const msg =
        `resolver_misconfigured: resolved base "${base}" missing "${requiredSeg}" ` +
        `(slug=${opts.slug}, version=${version}). ` +
        `Resolver must return "<baseUrl><prefix>/${opts.slug}/v${version}".`;
      const log = this.bindLog({
        slug: opts.slug,
        version,
        url: base,
        method,
        component: "SvcClient",
      });
      log.warn({ requiredSeg }, "resolver_misconfigured");
      throw new Error(msg);
    }

    const url = this.buildUrl(base, opts.path, opts.query);

    const headers: Record<string, string> = {
      "x-request-id": requestId,
      accept: "application/json",
      ...(this.defaults.headers ?? {}),
      ...(opts.headers ?? {}),
    };

    // ── Bearer attach (with small public exceptions) ─────────────────────────
    // Public endpoints: health, and public slugs (jwks, facilitator).
    const isHealthPath =
      opts.path === "health" ||
      opts.path.endsWith("/health") ||
      opts.path === "/health";

    const isPublicSlug = PUBLIC_SLUGS.has(opts.slug);

    if (!headers["authorization"] && !isHealthPath && !isPublicSlug) {
      const log = this.bindLog({
        slug: opts.slug,
        version,
        url,
        method,
        component: "SvcClient",
      });
      const jwt = await getBearerToken({
        aud: opts.slug,
        ttlSec: 120,
        // issuer: opts.iss is not a thing here; derive inside helper
        // helper resolves NV_ISSUER || NV_SERVICE_NAME, fail-fast if neither
        logger: log,
      });
      headers["authorization"] = `Bearer ${jwt}`;
    }

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
      const msg = String(err);
      log.error({ err: msg }, "s2s_exception");
      throw new Error(`s2s_exception: ${msg}`);
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
        data: payload as T, // typically the canonical envelope; caller validates/unwraps
        requestId: requestIdFromHeaders(resHeaders) ?? requestId,
      };
    }

    // Non-2xx → RFC7807 expected. Extract best-effort details.
    const rid = requestIdFromHeaders(resHeaders) ?? requestId;

    let msg = "upstream_error";
    if (payload && typeof payload === "object") {
      const p = payload as any;
      if (typeof p.detail === "string" && p.detail.length) msg = p.detail;
      else if (typeof p.message === "string" && p.message.length)
        msg = p.message;
    } else if (typeof payload === "string" && payload.length) {
      msg = payload;
    }

    log.warn(
      { upstreamStatus: res.status, message: msg },
      "s2s_upstream_error"
    );

    const errDetail =
      `s2s_upstream_error ${res.status} for ${method} ${url} ` +
      `(slug=${opts.slug}@v${version}, requestId=${rid}): ${msg}`;

    throw new Error(errDetail);
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
