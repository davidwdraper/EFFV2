// backend/services/gateway/src/controllers/proxy.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0003 (Gateway pulls svc map from svcfacilitator)
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR-0013 (Versioned Health — local, never proxied)
 *   - ADR-0033 (Internal-Only Services & health resolve fallback)
 *
 * Purpose:
 * - Thin controller for gateway proxying. Validates path, resolves upstream via SvcConfig,
 *   composes outbound URL, streams request/response, enforces hop-by-hop header rules.
 *
 * Invariants:
 * - No env-specific assumptions (dev == prod).
 * - Version required on all /api/<slug>/v<major>/... paths.
 */

import type { Request, Response, NextFunction } from "express";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import type { SvcConfig } from "../services/svcconfig/SvcConfig";
import { healthResolveTarget } from "../proxy/health/healthResolveTarget";

const SERVICE_NAME = (process.env.SVC_NAME || "gateway").trim() || "gateway";
const UPSTREAM_TIMEOUT_MS = 8000;

// RFC 7230 hop-by-hop headers we never forward
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
]);

function pickSingle(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v[0] == null ? undefined : String(v[0]);
  return String(v);
}

function cloneInboundHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    const sv = pickSingle(v);
    if (sv != null) out[lk] = sv;
  }
  return out;
}

function ensureRequestId(req: Request): string {
  return (
    req.header("x-request-id") ||
    req.header("x-correlation-id") ||
    req.header("request-id") ||
    (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
  );
}

function hasParsedBody(req: Request): req is Request & { body: unknown } {
  const anyReq = req as any;
  return (
    Object.prototype.hasOwnProperty.call(anyReq, "body") &&
    anyReq.body != null &&
    (typeof anyReq.body === "object" ||
      typeof anyReq.body === "string" ||
      typeof anyReq.body === "number" ||
      Array.isArray(anyReq.body))
  );
}

function isHealthSubpath(subpath: string): boolean {
  const norm = subpath.replace(/\/+$/, "");
  return /^\/health(?:\/[A-Za-z0-9_-]+)?$/.test(norm);
}

export class ProxyController {
  constructor(private readonly svccfg: SvcConfig) {}

  /** Handles ANY /api/:slug/v:version/* request except /api/gateway/... */
  public handle = async (req: Request, res: Response, _next: NextFunction) => {
    const originalUrl = req.originalUrl || req.url || "";

    // Never proxy Gateway’s own endpoints
    if (/^\/api\/gateway(?:\/|$)/i.test(originalUrl)) {
      return res.status(404).json({
        ok: false,
        service: SERVICE_NAME,
        data: { status: "not_found", detail: "gateway endpoints are local" },
      });
    }

    // Extract slug/version (required)
    let slug: string;
    let version: number;
    try {
      ({ slug, version } = UrlHelper.getSlugAndVersion(originalUrl));
    } catch {
      return res.status(400).json({
        ok: false,
        service: SERVICE_NAME,
        data: {
          status: "invalid_request",
          detail:
            "Invalid API path (version required). Expected /api/<slug>/v<major>/...",
        },
      });
    }
    if (!slug || slug.toLowerCase() === "gateway") {
      return res.status(404).json({
        ok: false,
        service: SERVICE_NAME,
        data: { status: "not_found", detail: "not a proxyable target" },
      });
    }

    // ───────────────────────────────────────────────────────────────────────
    // Resolve upstream baseUrl via mirror; if missing, gate strictly to health-only fallback.
    // ───────────────────────────────────────────────────────────────────────
    let baseUrl: string | null = null;
    let overridePort: number | null = null;

    try {
      baseUrl = this.svccfg.getUrlFromSlug(slug, version);
      if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) {
        throw new Error(
          `[svcconfig] Invalid baseUrl for ${slug}@${version} (expected full URL)`
        );
      }
    } catch (e: any) {
      // Mirror miss (e.g., internalOnly). ONLY allow /health or /health/<token> fallback.
      let isHealth = false;
      try {
        const addr = UrlHelper.parseApiPath(originalUrl);
        isHealth = isHealthSubpath(addr.subpath || "/");
      } catch {
        isHealth = false;
      }

      if (!isHealth) {
        // Do NOT attempt fallback for non-health paths. Hard-gate the exposure.
        return res.status(404).json({
          ok: false,
          service: SERVICE_NAME,
          data: {
            status: "not_found",
            detail:
              "target not in gateway mirror (internal-only or unknown) and not a health check",
          },
        });
      }

      // Health-only facilitator resolve — returns { baseUrl, port }
      const fallback = await healthResolveTarget(originalUrl, req.method);
      if (!fallback) {
        return res.status(502).json({
          ok: false,
          service: SERVICE_NAME,
          data: { status: "bad_gateway", detail: String(e?.message || e) },
        });
      }
      baseUrl = fallback.baseUrl;
      overridePort = fallback.port;
    }

    // Compose outbound URL
    let outboundUrl: string;
    try {
      // Prefer overridePort (health fallback); otherwise svcconfig-derived port or scheme default.
      const targetPort =
        overridePort ??
        (() => {
          try {
            return this.svccfg.getPortFromSlug(slug, version);
          } catch {
            const u = new URL(baseUrl!);
            return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
          }
        })();

      outboundUrl = UrlHelper.buildOutboundRequestUrl(
        baseUrl!,
        targetPort,
        originalUrl
      );
    } catch (e: any) {
      return res.status(502).json({
        ok: false,
        service: SERVICE_NAME,
        data: {
          status: "bad_gateway",
          detail: `proxy url compose failed: ${String(e?.message || e)}`,
        },
      });
    }

    const out = new URL(outboundUrl);
    if (out.hostname === "0.0.0.0" || out.hostname === "::") {
      return res.status(502).json({
        ok: false,
        service: SERVICE_NAME,
        data: {
          status: "bad_gateway",
          detail: "svcconfig: unroutable host (0.0.0.0/::)",
        },
      });
    }

    // Prepare upstream request
    const headers = cloneInboundHeaders(req);
    headers["x-service-name"] = SERVICE_NAME;
    headers["x-api-version"] = String(version);
    headers["x-request-id"] = ensureRequestId(req);

    const isTLS = out.protocol === "https:";
    const client = isTLS ? https : http;

    const options: http.RequestOptions = {
      protocol: out.protocol,
      hostname: out.hostname,
      port: out.port || (isTLS ? "443" : "80"),
      method: req.method,
      path: out.pathname + out.search,
      headers,
    };

    const abortTimer = setTimeout(() => {
      try {
        req.socket.destroy();
      } catch {
        /* ignore */
      }
    }, UPSTREAM_TIMEOUT_MS);

    const upstreamReq = client.request(options, (upstreamRes) => {
      clearTimeout(abortTimer);

      // Mirror status
      res.status(upstreamRes.statusCode || 502);

      // Mirror safe headers
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        const lk = key.toLowerCase();
        if (HOP_BY_HOP.has(lk)) continue;
        if (value == null) continue;
        if (Array.isArray(value))
          res.setHeader(key, value.filter(Boolean) as string[]);
        else res.setHeader(key, String(value));
      }

      upstreamRes.on("error", () => {
        try {
          if (!res.headersSent) res.status(502);
          if (!res.writableEnded) res.end();
        } catch {
          /* ignore */
        }
      });

      // Stream upstream → client
      upstreamRes.pipe(res, { end: true });
    });

    upstreamReq.on("error", () => {
      clearTimeout(abortTimer);
      if (!res.headersSent) {
        try {
          res
            .status(502)
            .json({
              ok: false,
              service: SERVICE_NAME,
              data: { status: "bad_gateway", detail: "proxy upstream error" },
            })
            .end();
          return;
        } catch {
          /* ignore */
        }
      }
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    });

    // Stream client → upstream (respecting prior body parsing)
    const method = (req.method || "GET").toUpperCase();
    const hasBodyMethod = method !== "GET" && method !== "HEAD";

    if (hasBodyMethod && hasParsedBody(req)) {
      const contentType =
        req.headers["content-type"] && pickSingle(req.headers["content-type"])
          ? String(pickSingle(req.headers["content-type"]))
          : "application/json";

      const raw =
        typeof (req as any).body === "string"
          ? Buffer.from((req as any).body as string)
          : Buffer.from(JSON.stringify((req as any).body));

      upstreamReq.setHeader("content-type", contentType);
      upstreamReq.setHeader("content-length", String(raw.length));
      upstreamReq.write(raw);
      upstreamReq.end();
    } else if (hasBodyMethod && req.readable) {
      req.pipe(upstreamReq);
    } else {
      upstreamReq.end();
    }
  };
}
