// backend/services/gateway/src/middleware/genericProxy.ts
import type { RequestHandler } from "express";
import { logger } from "../../../shared/utils/logger";
import { resolveUpstreamBase, isAllowedServiceSlug } from "../config";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

/**
 * Generic reverse proxy that forwards /<svc>/<rest...> to ENV[<SVC>_SERVICE_URL]/<rest...>.
 * - Mounted at /api so first segment is the service slug.
 * - No baked URLs; resolveUpstreamBase reads env.
 * - Streams request/response (no buffering).
 * - Preserves querystring, method, headers; sets x-forwarded-* and x-request-id.
 * - Rejects if <svc> not in allowlist or env key missing.
 */
export function genericProxy(): RequestHandler {
  return (req, res) => {
    // Because this is mounted at /api, req.url begins with "/<svc>/..."
    const pathOnly = (req.url || "/").split("?")[0];
    const segments = pathOnly.split("/").filter(Boolean);
    const svc = segments[0] || "";

    logger.debug(
      {
        requestId: (req as any).id,
        method: req.method,
        originalUrl: req.originalUrl,
        url: req.url,
        svc,
      },
      "[gateway] inbound"
    );

    if (!svc || !isAllowedServiceSlug(svc)) {
      logger.warn(
        {
          requestId: (req as any).id,
          svc,
          reason: "unknown_or_disallowed_service",
        },
        "[gateway] reject"
      );
      res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Unknown or disallowed service",
        instance: (req as any).id,
      });
      return;
    }

    let upstream: { svcKey: string; base: string };
    try {
      logger.debug(
        { requestId: (req as any).id, svc },
        "[gateway] resolving upstream"
      );
      upstream = resolveUpstreamBase(svc); // { svcKey, base }
      logger.debug(
        {
          requestId: (req as any).id,
          svc,
          envKey: upstream.svcKey,
          base: upstream.base,
        },
        "[gateway] resolved upstream"
      );
    } catch (e: any) {
      logger.error(
        {
          requestId: (req as any).id,
          svc,
          err: e?.message || String(e),
        },
        "[gateway] resolveUpstreamBase error"
      );
      res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: e?.message || "Missing upstream configuration",
        instance: (req as any).id,
      });
      return;
    }

    // Join base + rest of path
    const restPath = "/" + segments.slice(1).join("/");
    const qs = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
    const targetUrl = upstream.base + restPath + qs;

    // Prepare headers: drop hop-by-hop and set x-forwarded-*
    const { headers } = req;
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
    for (const [k, v] of Object.entries(headers)) {
      if (!k) continue;
      if (hop.has(k.toLowerCase())) continue;
      if (Array.isArray(v)) {
        outHeaders[k] = v.join(", ");
      } else if (typeof v === "string") {
        outHeaders[k] = v;
      }
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

    logger.debug(
      {
        requestId: (req as any).id,
        svc,
        envKey: upstream.svcKey,
        target: targetUrl,
        method: req.method,
        hasAuth: Boolean(outHeaders["authorization"]),
      },
      "[gateway] proxy enter"
    );

    // Make request
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
              svc,
              envKey: upstream.svcKey,
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
        {
          requestId: (req as any).id,
          svc,
          envKey: upstream?.svcKey,
          target: targetUrl,
          err,
        },
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
  };
}

function mergeForwardedFor(
  existing: string | string[] | undefined,
  addr?: string | null
) {
  const xs = Array.isArray(existing) ? existing.join(", ") : existing || "";
  if (!addr) return xs || "";
  return xs ? `${xs}, ${addr}` : String(addr);
}
