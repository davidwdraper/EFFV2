// backend/services/gateway/src/routes/proxy.ts
/**
 * Gateway Proxy (port-only swap; versioned everything incl. health)
 *
 * SOP:
 * - All proxied routes use: /api/<slug>/v<major>/...
 * - Health is VERSIONED: /api/<slug>/v<major>/health/...
 * - Gateway's own health stays local at /api/gateway/health/...
 *
 * Behavior:
 * - Never proxy /api/gateway/... (handled locally).
 * - For any other /api/<slug>/v<major>/..., resolve <slug>@<major> to a port,
 *   build upstream by swapping PORT ONLY, keep scheme/host/path/query.
 * - Strip Authorization & Host; add x-service-name.
 * - If missing version on non-gateway API, 400.
 */

import type { Request, Response, NextFunction } from "express";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { SvcConfig } from "../services/svcconfig/SvcConfig";

const SVC_NAME = (process.env.SVC_NAME || "gateway").trim() || "gateway";

// Helpers --------------------------------------------------------------------

function getInboundHostParts(req: Request): { hostname: string } {
  const host = (req.get("host") || "").trim();
  if (!host) return { hostname: "127.0.0.1" };
  // strip port if present; we ignore it because we’ll replace with targetPort
  // (host may include IPv6 like [::1]; keep it intact minus :port)
  const idx = host.lastIndexOf(":");
  if (idx > 0 && !host.endsWith("]")) return { hostname: host.slice(0, idx) };
  return { hostname: host };
}

function makeAbsoluteUrl(
  req: Request,
  hostname: string,
  port: number,
  originalUrl: string
): string {
  const proto = (req.protocol || "http").toLowerCase();
  return `${proto}://${hostname}:${port}${originalUrl}`;
}

function extractPortFromBaseUrl(baseUrl: string): number {
  const u = new URL(baseUrl);
  if (u.port) return Number(u.port);
  return u.protocol === "https:" ? 443 : 80;
}

// Main -----------------------------------------------------------------------

export function makeProxy(svccfg: SvcConfig) {
  return async function proxy(req: Request, res: Response, next: NextFunction) {
    const originalUrl = req.originalUrl;

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
      // If it looks like an API path but is missing version, return 400.
      // Accept only /api/<slug>/v<major>/... for proxied routes now.
      const m = originalUrl.match(/^\/api\/([^/]+)(?:\/|$)/i);
      if (m && m[1] && m[1].toLowerCase() !== "gateway") {
        return res.status(400).json({
          ok: false,
          service: SVC_NAME,
          data: {
            status: "invalid_request",
            detail:
              "Missing API version. Expected /api/<slug>/v<major>/... (health is versioned).",
          },
        });
      }
      return next();
    }

    if (!slug || slug === "gateway") return next();
    if (version == null) {
      return res.status(400).json({
        ok: false,
        service: SVC_NAME,
        data: {
          status: "invalid_request",
          detail:
            "Missing API version. Expected /api/<slug>/v<major>/... (health is versioned).",
        },
      });
    }

    // Resolve target port from svcconfig using <slug>@<version>
    let targetPort: number;
    try {
      // If you have getPortFromSlug use it; otherwise extract from URL.
      const base = (svccfg as any).getPortFromSlug
        ? (svccfg as any).getPortFromSlug(slug, version)
        : svccfg.getUrlFromSlug(slug, version);

      targetPort =
        typeof base === "number" ? base : extractPortFromBaseUrl(String(base));
    } catch (e: any) {
      return res.status(502).json({
        ok: false,
        service: SVC_NAME,
        data: { status: "bad_gateway", detail: String(e?.message || e) },
      });
    }

    const { hostname } = getInboundHostParts(req);
    const upstream = makeAbsoluteUrl(req, hostname, targetPort, originalUrl);

    return forward(upstream, req, res);
  };
}

// Forwarder ------------------------------------------------------------------

async function forward(upstream: string, req: Request, res: Response) {
  // Build outbound headers: strip Authorization & Host
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    const key = k.toLowerCase();
    if (key === "host" || key === "authorization") continue;
    headers[key] = Array.isArray(v) ? v[0] : String(v);
  }
  headers["x-service-name"] = SVC_NAME;
  headers["accept"] = headers["accept"] || "application/json";

  // Body (JSON if applicable)
  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(req.method)) {
    if (req.is("application/json") && typeof req.body === "object") {
      body = JSON.stringify(req.body);
      headers["content-type"] = "application/json";
    } else if (typeof req.body === "string" || req.body instanceof Buffer) {
      body = req.body as any;
    }
  }

  try {
    const upstreamResp = (await fetch(upstream, {
      method: req.method,
      headers,
      body,
    })) as unknown as globalThis.Response;

    res.status(upstreamResp.status);
    upstreamResp.headers.forEach((value, key) => {
      if (
        /^(transfer-encoding|connection|keep-alive|proxy-connection|upgrade|host)$/i.test(
          key
        )
      )
        return;
      res.setHeader(key, value);
    });

    const ct = upstreamResp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const json = await upstreamResp.json().catch(() => undefined);
      if (json === undefined) res.end();
      else res.json(json);
    } else {
      const text = await upstreamResp.text().catch(() => "");
      res.send(text);
    }
  } catch (err) {
    res.status(502).json({
      ok: false,
      service: SVC_NAME,
      data: {
        status: "bad_gateway",
        detail: `proxy fetch failed: ${String(err)}`,
      },
    });
  }
}
