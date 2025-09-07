// backend/services/gateway/src/middleware/serviceProxy.ts
import type { RequestHandler } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "@shared/utils/logger";
import { ROUTE_ALIAS } from "../config";

import { getSvcconfigSnapshot, mintS2S } from "@shared/svcconfig/client";
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

/**
 * Reverse proxy mounted at /api that forwards:
 *   /api/<svc>/<rest...> -> <cfg.baseUrl><cfg.outboundApiPrefix||/api>/<rest...>
 *
 * Rules:
 *  - Uses alias map + naive singularization to resolve canonical slug.
 *  - Only proxies services present AND {enabled:true, allowProxy:true}.
 *  - Streams request/response (no buffering).
 *  - Preserves querystring and most headers; strips hop-by-hop ones.
 *  - Sets x-forwarded-*, x-request-id.
 *  - 🚨 Mints S2S Authorization for upstream (replaces client Authorization).
 */
export function serviceProxy(): RequestHandler {
  return (req, res) => {
    // Expect to be mounted at /api — so first segment is the slug
    const segments = (req.url || "/").split("?")[0].split("/").filter(Boolean);
    const seg = segments[0] || "";

    // Guard against mis-mounting at root (would give seg==="api")
    if (seg === "api") {
      logger.error(
        { url: req.url, path: req.path },
        "[gateway] serviceProxy mounted at root"
      );
      return res.status(500).json({
        type: "about:blank",
        title: "Gateway Misconfiguration",
        status: 500,
        detail: "serviceProxy must be mounted at /api",
        instance: (req as any).id,
      });
    }

    const slug = resolveSlug(seg);
    const cfg = getService(slug);
    if (!cfg) {
      res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Unknown or disallowed service",
        instance: (req as any).id,
      });
      return;
    }

    const base = upstreamBase(cfg);
    const restPath = "/" + segments.slice(1).join("/");
    const qs = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
    const targetUrl = base + restPath + qs;

    // Prepare headers
    const hop = new Set([
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
      "host",
    ]);
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!k) continue;
      if (hop.has(k.toLowerCase())) continue;
      if (k.toLowerCase() === "authorization") continue; // 🚫 never forward client auth upstream
      if (Array.isArray(v)) outHeaders[k] = v.join(", ");
      else if (typeof v === "string") outHeaders[k] = v;
    }

    // Always attach S2S Authorization for upstream
    try {
      outHeaders["authorization"] = `Bearer ${mintS2S(300)}`;
    } catch (e) {
      logger.error({ err: e }, "[gateway] failed to mint S2S token");
      return res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to prepare upstream authorization",
        instance: (req as any).id,
      });
    }

    // x-forwarded-* and request id
    const xfHost = req.headers["x-forwarded-host"]
      ? String(req.headers["x-forwarded-host"])
      : String(req.headers["host"] || "");
    outHeaders["x-forwarded-for"] = mergeForwardedFor(
      req.headers["x-forwarded-for"],
      req.socket?.remoteAddress
    );
    if (xfHost) outHeaders["x-forwarded-host"] = xfHost;
    outHeaders["x-forwarded-proto"] = (req as any).protocol || "http";
    outHeaders["x-request-id"] =
      (req as any).id ||
      (Array.isArray(req.headers["x-request-id"])
        ? req.headers["x-request-id"][0]
        : (req.headers["x-request-id"] as string)) ||
      "";

    // Dispatch
    const urlObj = new URL(targetUrl);
    const agent = urlObj.protocol === "https:" ? https : http;

    const upstreamReq = agent.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        method: req.method,
        path: urlObj.pathname + urlObj.search,
        headers: outHeaders,
      },
      (upstreamRes) => {
        // Pass through status + headers (minus hop-by-hop)
        const safeHeaders: Record<string, number | string | string[]> = {};
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (!k) continue;
          if (hop.has(k.toLowerCase())) continue;
          if (v !== undefined) safeHeaders[k] = v as any;
        }
        res.writeHead(upstreamRes.statusCode || 502, safeHeaders);
        upstreamRes.pipe(res);
        upstreamRes.on("end", () => {
          logger.debug(
            {
              requestId: (req as any).id,
              svc: slug,
              target: targetUrl,
              status: upstreamRes.statusCode,
            },
            "[gateway] proxy exit"
          );
        });
      }
    );

    upstreamReq.on("error", (err: any) => {
      const code = String(err?.code || "");
      const timeout =
        code === "ECONNABORTED" ||
        (typeof err?.message === "string" &&
          err.message.toLowerCase().includes("timeout"));
      const connErr =
        code === "ECONNREFUSED" ||
        code === "ECONNRESET" ||
        code === "EHOSTUNREACH";
      const status = timeout ? 504 : connErr ? 502 : 500;

      logger.error(
        { requestId: (req as any).id, svc: slug, target: targetUrl, err },
        "[gateway] proxy error"
      );
      if (!res.headersSent) {
        res.status(status).json({
          type: "about:blank",
          title: status === 504 ? "Gateway Timeout" : "Bad Gateway",
          status,
          detail: err?.message || "Upstream error",
          instance: (req as any).id,
        });
      } else {
        try {
          res.end();
        } catch {}
      }
    });

    // Stream body
    req.pipe(upstreamReq);
    logger.debug(
      {
        requestId: (req as any).id,
        svc: slug,
        target: targetUrl,
        method: req.method,
      },
      "[gateway] proxy enter"
    );
  };
}

function resolveSlug(seg: string): string {
  const lower = String(seg || "").toLowerCase();
  const aliased = (ROUTE_ALIAS as Record<string, string>)[lower] || lower;
  return aliased.endsWith("s") ? aliased.slice(0, -1) : aliased;
}

function getService(slug: string): ServiceConfig | undefined {
  const snap = getSvcconfigSnapshot();
  if (!snap) return undefined;
  const cfg = snap.services[slug];
  if (!cfg) return undefined;
  if (cfg.enabled !== true) return undefined;
  if (cfg.allowProxy !== true) return undefined;
  return cfg;
}

function upstreamBase(cfg: ServiceConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const apiPrefix = (cfg.outboundApiPrefix || "/api").replace(/^\/?/, "/");
  return `${base}${apiPrefix}`;
}

function mergeForwardedFor(
  existing: string | string[] | undefined,
  addr?: string | null
) {
  const xs = Array.isArray(existing) ? existing.join(", ") : existing || "";
  if (!addr) return xs || "";
  return xs ? `${xs}, ${addr}` : String(addr);
}
