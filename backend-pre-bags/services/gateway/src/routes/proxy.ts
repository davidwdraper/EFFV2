// backend/services/gateway/src/routes/proxy.ts
/**
 * Gateway Proxy — strict, svcconfig-resolved, and not a god-file.
 *
 * SOP (reaffirmed):
 * - Versioned paths only: /api/<slug>/v<major>/...
 * - Never proxy /api/gateway/... (handled locally).
 * - Resolve FULL upstream strictly via SvcConfig (no env/dev fallbacks).
 * - Compose outbound request URL using UrlHelper (single source of truth).
 * - Do not alter payload; stream req → upstream and upstream → res.
 * - If a body parser already ran, re-serialize and forward verbatim.
 * - Strip hop-by-hop headers both directions.
 * - Add minimal S2S headers: x-service-name, x-request-id, x-api-version.
 */

import type { Request, Response, NextFunction } from "express";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import type { SvcConfig } from "../services/svcconfig/SvcConfig";

// ────────────────────────────────────────────────────────────────────────────
// Constants (separate concerns: config/limits)
// ────────────────────────────────────────────────────────────────────────────

const SERVICE_NAME = (process.env.SVC_NAME || "gateway").trim() || "gateway";
const UPSTREAM_TIMEOUT_MS = 8000;

// RFC 7230 hop-by-hop headers that must never be forwarded
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

// ────────────────────────────────────────────────────────────────────────────
/** Small helpers (kept tiny; anything larger belongs in shared/*) */
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Proxy factory
// ────────────────────────────────────────────────────────────────────────────

export function makeProxy(svccfg: SvcConfig) {
  return function proxy(req: Request, res: Response, next: NextFunction) {
    const originalUrl = req.originalUrl || req.url || "";

    // Never proxy the gateway’s own endpoints
    if (/^\/api\/gateway(?:\/|$)/i.test(originalUrl)) return next();

    // Extract slug/version using shared logic (version required per SOP).
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
    if (!slug || slug.toLowerCase() === "gateway") return next();

    // Resolve upstream base URL strictly from svcconfig
    let baseUrl: string;
    try {
      baseUrl = svccfg.getUrlFromSlug(slug, version);
      if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) {
        throw new Error(
          `[svcconfig] Invalid baseUrl for ${slug}@${version} (expected full URL)`
        );
      }
    } catch (e: any) {
      return res.status(502).json({
        ok: false,
        service: SERVICE_NAME,
        data: { status: "bad_gateway", detail: String(e?.message || e) },
      });
    }

    // Prefer explicit port from svcconfig (if available) for clarity; otherwise keep baseUrl’s port.
    let targetPort: number;
    try {
      targetPort = svccfg.getPortFromSlug(slug, version);
    } catch {
      const u = new URL(baseUrl);
      targetPort = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    }

    // Build the full outbound request URL using UrlHelper (single composition point).
    let outboundUrl: string;
    try {
      outboundUrl = UrlHelper.buildOutboundRequestUrl(
        baseUrl,
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

    // ---- Prepare upstream request
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

    // Stream client → upstream. If a body parser already consumed the stream,
    // faithfully forward the parsed body as JSON (no shape changes).
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
