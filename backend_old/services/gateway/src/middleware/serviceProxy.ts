// PATH: backend/services/gateway/src/middleware/serviceProxy.ts

/**
 * APR-0029 — serviceProxy (streams + API version header)
 * --------------------------------------------------------------------------
 * Purpose:
 * - Thin reverse proxy that streams request/response bodies without buffering.
 * - Forwards X-NV-Api-Version (derived from resolveServiceFromSlug) as "V#".
 *
 * Alignment with your resolver:
 * - resolveServiceFromSlug attaches:
 *     (req as any).resolvedService = {
 *       slug: string,
 *       version: number,     // e.g. 1
 *       baseUrl: string,
 *       apiPrefix: string,
 *       targetUrl: string
 *     }
 * - We convert that numeric version to the canonical header value "V#" (e.g., 1 → "V1").
 *
 * Notes:
 * - Strips hop-by-hop headers; preserves gateway-minted Authorization and
 *   X-NV-User-Assertion (injected by injectUpstreamIdentity()).
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "@eff/shared/src/utils/logger";

export function serviceProxy(): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    const r = (req as any).resolvedService as
      | {
          slug: string;
          version?: number | string;
          baseUrl: string;
          targetUrl: string;
        }
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

    // RFC 7230 hop-by-hop headers that must not be forwarded.
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
    // - Drop hop-by-hop
    // - Preserve Authorization & X-NV-User-Assertion (gateway minted them)
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!k) continue;
      if (hop.has(k.toLowerCase())) continue;
      if (Array.isArray(v)) outHeaders[k] = v.join(", ");
      else if (typeof v === "string") outHeaders[k] = v;
    }

    // Forwarded & tracing headers
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

    // APR-0029: stamp canonical API version header as "V#".
    if (r.version !== undefined) {
      const ver =
        typeof r.version === "number"
          ? `V${r.version}`
          : /^v?\d+$/i.test(String(r.version))
          ? `V${String(r.version).replace(/^v/i, "")}`
          : String(r.version);
      outHeaders["X-NV-Api-Version"] = ver;
    }

    const urlObj = new URL(targetUrl);
    const agent = urlObj.protocol === "https:" ? https : http;

    logger.debug(
      {
        requestId: (req as any).id,
        svc: r.slug,
        version: r.version,
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
        path: urlObj.pathname + urlObj.search,
        headers: outHeaders,
      },
      (upstreamRes) => {
        // Mirror response headers except hop-by-hop ones.
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
              version: r.version,
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
          svc: r.slug,
          version: r.version,
          target: targetUrl,
          err,
        },
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

    // Stream request body to upstream.
    req.pipe(upstreamReq);
  };
}

// Helper: merge/append X-Forwarded-For chains safely.
function mergeForwardedFor(
  existing: string | string[] | undefined,
  addr?: string | null
) {
  const xs = Array.isArray(existing) ? existing.join(", ") : existing || "";
  if (!addr) return xs || "";
  return xs ? `${xs}, ${addr}` : String(addr);
}
