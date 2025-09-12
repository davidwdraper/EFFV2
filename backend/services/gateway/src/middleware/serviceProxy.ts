// backend/services/gateway/src/middleware/serviceProxy.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *
 * Why:
 * - Thin transport-only reverse proxy for `/api/<slug>/<rest...>`.
 * - Streams bodies; strips hop-by-hop headers; never forwards client Authorization.
 */
import type { RequestHandler } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "@eff/shared/src/utils/logger";
import { ROUTE_ALIAS } from "../config";
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";
import type { ServiceConfig } from "@eff/shared/src/contracts/svcconfig.contract";

export function serviceProxy(): RequestHandler {
  return (req, res) => {
    const segments = (req.url || "/").split("?")[0].split("/").filter(Boolean);
    const seg = segments[0] || "";

    if (seg === "api") {
      logger.error({ url: req.url, path: req.path }, "[gateway] proxy at root");
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
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Unknown or disallowed service",
        instance: (req as any).id,
      });
    }

    const base = upstreamBase(cfg);
    const restPath = "/" + segments.slice(1).join("/");
    const qs = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
    const targetUrl = base + restPath + qs;

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
      if (k.toLowerCase() === "authorization") continue;
      if (Array.isArray(v)) outHeaders[k] = v.join(", ");
      else if (typeof v === "string") outHeaders[k] = v;
    }

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
        return res.status(status).json({
          type: "about:blank",
          title: status === 504 ? "Gateway Timeout" : "Bad Gateway",
          status,
          detail: err?.message || "Upstream error",
          instance: (req as any).id,
        });
      }
      try {
        res.end();
      } catch {
        /* ignore */
      }
    });

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

// Helpers
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
