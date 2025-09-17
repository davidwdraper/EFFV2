// backend/services/gateway/src/middleware/serviceProxy.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0021-gateway-core-internal-no-edge-guardrails.md
 *
 * Why:
 * - Thin transport-only reverse proxy for `/api/:slug/<plural...>`.
 * - Streams bodies; strips hop-by-hop headers; **preserves** gateway-minted
 *   Authorization and X-NV-User-Assertion (set by injectUpstreamIdentity()).
 *
 * Notes:
 * - This version relies on resolveServiceFromSlug() having already set
 *   (req as any).resolvedService = { slug, baseUrl, targetUrl }.
 * - We DO NOT recompute the target from req.url; that caused loss of "/acts".
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "@eff/shared/src/utils/logger";

export function serviceProxy(): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    const r = (req as any).resolvedService as
      | { slug: string; baseUrl: string; targetUrl: string }
      | undefined;

    if (!r?.targetUrl) {
      return res.status(502).json({
        type: "about:blank",
        title: "Bad Gateway",
        status: 502,
        detail: "Service resolution missing",
        instance: (req as any).id,
      });
    }

    const targetUrl = r.targetUrl;

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

    // Build outbound headers:
    // - Strip hop-by-hop headers
    // - DO NOT strip Authorization (gateway minted it)
    // - Preserve X-NV-User-Assertion (gateway minted it)
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!k) continue;
      if (hop.has(k.toLowerCase())) continue;
      // Authorization is intentionally preserved
      // X-NV-User-Assertion is intentionally preserved
      if (Array.isArray(v)) outHeaders[k] = v.join(", ");
      else if (typeof v === "string") outHeaders[k] = v;
    }

    // Forwarded headers
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

    // Log without leaking secrets
    logger.debug(
      {
        requestId: (req as any).id,
        svc: r.slug,
        target: targetUrl,
        method: req.method,
        hasAuth: typeof outHeaders["authorization"] === "string",
        hasUA: typeof outHeaders["x-nv-user-assertion"] === "string",
      },
      "[gateway] proxy enter"
    );

    const upstreamReq = agent.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        method: req.method,
        path: urlObj.pathname + urlObj.search, // full path from resolved target
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
              svc: r.slug,
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
        { requestId: (req as any).id, svc: r.slug, target: targetUrl, err },
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

    // Stream the incoming body to upstream
    req.pipe(upstreamReq);
  };
}

// Helpers
function mergeForwardedFor(
  existing: string | string[] | undefined,
  addr?: string | null
) {
  const xs = Array.isArray(existing) ? existing.join(", ") : existing || "";
  if (!addr) return xs || "";
  return xs ? `${xs}, ${addr}` : String(addr);
}
