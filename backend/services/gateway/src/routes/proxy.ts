// backend/services/gateway/src/routes/proxy.ts
/**
 * Gateway Proxy — svcconfig-resolved, streaming, no body parsing.
 *
 * SOP:
 * - Versioned paths: /api/<slug>/v<major>/...
 * - Never proxy /api/gateway/... (handled locally).
 * - Resolve FULL upstream (protocol, host, port) from svcconfig at request time.
 * - Do not touch body; stream req -> upstream and upstream -> res.
 * - Strip hop-by-hop headers both directions.
 * - Add minimal S2S headers: x-service-name, x-request-id, x-api-version.
 */

import type { Request, Response, NextFunction } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import crypto from "node:crypto";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import type { SvcConfig } from "../services/svcconfig/SvcConfig";

const SERVICE_NAME = (process.env.SVC_NAME || "gateway").trim() || "gateway";
const UPSTREAM_TIMEOUT_MS = 8000;

// Hop-by-hop headers that must never be forwarded
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

function composeKey(slug: string, version: number): string {
  return `${slug.toLowerCase()}@${version}`;
}

function resolveBaseUrl(
  svccfg: SvcConfig,
  slug: string,
  version: number
): string {
  // Prefer a URL string if available; fall back to port if that’s all we have.
  if (typeof (svccfg as any).getUrlFromSlug === "function") {
    const url = (svccfg as any).getUrlFromSlug(slug, version);
    if (typeof url === "string" && url.startsWith("http")) return url;
  }
  if (typeof (svccfg as any).get === "function") {
    const rec = (svccfg as any).get(composeKey(slug, version));
    if (rec?.baseUrl && typeof rec.baseUrl === "string") return rec.baseUrl;
    if (typeof rec?.port === "number") return `http://127.0.0.1:${rec.port}`;
  }
  if ((svccfg as any).mirror && typeof (svccfg as any).mirror === "object") {
    const rec = (svccfg as any).mirror[composeKey(slug, version)];
    if (rec?.baseUrl && typeof rec.baseUrl === "string") return rec.baseUrl;
    if (typeof rec?.port === "number") return `http://127.0.0.1:${rec.port}`;
  }
  if (typeof (svccfg as any).getPortFromSlug === "function") {
    const p = (svccfg as any).getPortFromSlug(slug, version);
    if (typeof p === "number") return `http://127.0.0.1:${p}`;
    if (typeof p === "string" && p.startsWith("http")) return p;
  }
  throw new Error(
    `[svcconfig] Unknown or unusable record for ${composeKey(slug, version)}`
  );
}

export function makeProxy(svccfg: SvcConfig) {
  return function proxy(req: Request, res: Response, next: NextFunction) {
    const originalUrl = req.originalUrl || req.url || "";

    // Never proxy the gateway’s own endpoints
    if (/^\/api\/gateway(?:\/|$)/i.test(originalUrl)) return next();

    // Parse canonical API path: /api/<slug>/v<major>/...
    let slug = "";
    let version: number | undefined;
    try {
      const addr = UrlHelper.parseApiPath(originalUrl);
      slug = addr.slug;
      version = addr.version;
    } catch {
      const m = originalUrl.match(/^\/api\/([^/]+)(?:\/|$)/i);
      if (m && m[1] && m[1].toLowerCase() !== "gateway") {
        return res.status(400).json({
          ok: false,
          service: SERVICE_NAME,
          data: {
            status: "invalid_request",
            detail:
              "Missing API version. Expected /api/<slug>/v<major>/... (health is versioned).",
          },
        });
      }
      return next();
    }

    if (!slug || slug.toLowerCase() === "gateway") return next();
    if (version == null) {
      return res.status(400).json({
        ok: false,
        service: SERVICE_NAME,
        data: {
          status: "invalid_request",
          detail:
            "Missing API version. Expected /api/<slug>/v<major>/... (health is versioned).",
        },
      });
    }

    // Resolve FULL upstream base URL from svcconfig
    let baseUrlStr: string;
    try {
      baseUrlStr = resolveBaseUrl(svccfg, slug, version);
    } catch (e: any) {
      return res.status(502).json({
        ok: false,
        service: SERVICE_NAME,
        data: { status: "bad_gateway", detail: String(e?.message || e) },
      });
    }

    const base = new URL(baseUrlStr);
    if (base.hostname === "0.0.0.0" || base.hostname === "::") {
      return res.status(502).json({
        ok: false,
        service: SERVICE_NAME,
        data: {
          status: "bad_gateway",
          detail: "svcconfig: unroutable host (0.0.0.0/::). Fix advertisement.",
        },
      });
    }

    // Build full upstream by replacing origin; keep path+query
    const upstream = new URL(originalUrl, base);
    upstream.protocol = base.protocol;
    upstream.hostname = base.hostname;
    upstream.port = base.port || (base.protocol === "https:" ? "443" : "80");

    // ---- Prepare upstream request
    const headers = cloneInboundHeaders(req);
    headers["x-service-name"] = SERVICE_NAME;
    headers["x-api-version"] = String(version);
    headers["x-request-id"] = ensureRequestId(req);

    const isTLS = upstream.protocol === "https:";
    const client = isTLS ? https : http;

    const options: http.RequestOptions = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: upstream.pathname + upstream.search,
      headers,
    };

    const abortTimer = setTimeout(() => {
      // Drop client if we stall talking to upstream
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

    // Stream client → upstream (no parsing)
    if (req.readable && req.method !== "GET" && req.method !== "HEAD") {
      req.pipe(upstreamReq);
    } else {
      upstreamReq.end();
    }
  };
}
