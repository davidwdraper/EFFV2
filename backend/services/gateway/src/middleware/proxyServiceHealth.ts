// backend/services/gateway/src/middleware/proxyServiceHealth.ts
/**
 * Proxy service health endpoints without the /api prefix.
 *
 * Maps:   /:slug/health/...  →  <svc.baseUrl>/health/...
 * Policy: Public, unauthenticated, not audited (same as gateway /health).
 *
 * Why:
 * - Some smoke tests (e.g. #12) probe service health "via gateway" using
 *   /user/health/live or /act/health/ready. The gateway's normal plane is
 *   /api/:slug/..., which would add outboundApiPrefix. Health must bypass that.
 */

import type { Request, Response } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "@eff/shared/src/utils/logger";
import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";
import type { ServiceConfig } from "@eff/shared/src/contracts/svcconfig.contract";

function resolveService(slug: string): ServiceConfig | null {
  const snap = getSvcconfigSnapshot();
  if (!snap) return null;
  const cfg = snap.services[String(slug || "").toLowerCase()];
  if (!cfg) return null;
  if (cfg.enabled !== true) return null;
  return cfg;
}

function trimEndSlash(s: string) {
  return String(s || "").replace(/\/+$/, "");
}

export function proxyServiceHealth() {
  return (req: Request, res: Response) => {
    const slug = String((req.params as any)?.slug || "").toLowerCase();
    if (!slug) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Missing service slug",
        instance: (req as any).id,
      });
    }

    const cfg = resolveService(slug);
    if (!cfg) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: `Service '${slug}' unavailable (unknown or disabled).`,
        instance: (req as any).id,
      });
    }

    // Compose target: baseUrl + /health + remainder
    const base = trimEndSlash(cfg.baseUrl);
    // req.baseUrl will be '/:slug/health' due to mount; use originalUrl to get the rest
    const full = req.originalUrl || req.url || "/health";
    const remainder = full.replace(/^\/[^/]+\/health/, "") || "";
    const targetUrl = `${base}/health${remainder}`;

    const url = new URL(targetUrl);
    const agent = url.protocol === "https:" ? https : http;

    // Strip hop-by-hop headers; pass minimal forwards
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
      "authorization", // never forward client auth
    ]);

    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!k) continue;
      if (hop.has(k.toLowerCase())) continue;
      if (Array.isArray(v)) outHeaders[k] = v.join(", ");
      else if (typeof v === "string") outHeaders[k] = v;
    }
    const xfHost = req.headers["x-forwarded-host"]
      ? String(req.headers["x-forwarded-host"])
      : String(req.headers["host"] || "");
    if (xfHost) outHeaders["x-forwarded-host"] = xfHost;
    outHeaders["x-forwarded-proto"] = (req as any).protocol || "http";
    outHeaders["x-request-id"] =
      (req as any).id ||
      (Array.isArray(req.headers["x-request-id"])
        ? req.headers["x-request-id"][0]
        : (req.headers["x-request-id"] as string)) ||
      "";

    const upstreamReq = agent.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        method: req.method,
        path: url.pathname + url.search,
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
            "[gateway] health proxy exit"
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
        "[gateway] health proxy error"
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

    // Health is usually GET/HEAD; still stream to be generic
    req.pipe(upstreamReq);

    logger.debug(
      {
        requestId: (req as any).id,
        svc: slug,
        target: targetUrl,
        method: req.method,
      },
      "[gateway] health proxy enter"
    );
  };
}
