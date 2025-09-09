// backend/services/gateway/src/middleware/serviceProxy.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • Route Convention: /api/<slug>/<rest> with gateway stripping <slug>
 *   • Only gateway is public; internal workers require S2S
 *   • Instrumentation everywhere; never block foreground traffic
 *   • “No logic in routes” → proxy is transport, not business logic
 * - This session’s design: Security vs Billing split
 *   • Guardrails (auth, rate limits, breaker, timeouts) run BEFORE proxy
 *   • Guardrail denials log to SECURITY (not WAL)
 *   • Audit WAL captures only passed requests in auditCapture (after guardrails)
 *
 * Why:
 * This is the *thin* reverse proxy that forwards `/api/<svc>/<rest...>` to the
 * resolved upstream service base + its outbound API prefix, **streaming** request
 * and response bodies without buffering.
 *
 * Key invariants:
 * - **Routing:** First path segment under `/api` is the canonical service slug
 *   (after aliasing + naive singularization). We proxy only if the service exists
 *   in svcconfig and is `{ enabled: true, allowProxy: true }`.
 * - **Headers:** Strip hop-by-hop headers; propagate `x-forwarded-*` and `x-request-id`.
 *   Never forward the client’s Authorization; instead, **mint a fresh S2S** token
 *   for the upstream.
 * - **Transport:** Use Node’s native http/https with streaming to avoid memory
 *   pressure and to keep latency predictable. No retries here—fail fast and let
 *   guardrails + circuit breaker handle stability concerns.
 * - **Observability:** Log a `proxy enter` and `proxy exit/error` at debug level
 *   with `requestId`, `svc`, `target`, and `status` for traceability.
 */

import type { RequestHandler } from "express";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { logger } from "@shared/utils/logger";
import { ROUTE_ALIAS } from "../config";
import { getSvcconfigSnapshot, mintS2S } from "@shared/svcconfig/client";
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

export function serviceProxy(): RequestHandler {
  return (req, res) => {
    // WHY: mounted under /api — so first non-empty segment is the service slug.
    const segments = (req.url || "/").split("?")[0].split("/").filter(Boolean);
    const seg = segments[0] || "";

    // WHY: guard against accidental mount at root (would make seg==="api").
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
      // WHY: unknown/disallowed service; nothing to proxy.
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

    // ── Header preparation ───────────────────────────────────────────────────
    // WHY: hop-by-hop headers must not be forwarded per RFC 7230 §6.1.
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
      if (k.toLowerCase() === "authorization") continue; // NEVER forward client auth upstream
      if (Array.isArray(v)) outHeaders[k] = v.join(", ");
      else if (typeof v === "string") outHeaders[k] = v;
    }

    // WHY: Always inject a fresh S2S token for upstream authentication; this is
    // the boundary where the gateway asserts *its* identity to internal workers.
    try {
      outHeaders["authorization"] = `Bearer ${mintS2S(300)}`; // 5m TTL is ample
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

    // WHY: Preserve forwarding chain for observability and auth decisions upstream.
    const xfHost = req.headers["x-forwarded-host"]
      ? String(req.headers["x-forwarded-host"])
      : String(req.headers["host"] || "");
    outHeaders["x-forwarded-for"] = mergeForwardedFor(
      req.headers["x-forwarded-for"],
      req.socket?.remoteAddress
    );
    if (xfHost) outHeaders["x-forwarded-host"] = xfHost;
    // Express sets req.protocol when trust proxy is enabled; keep fallback conservative.
    outHeaders["x-forwarded-proto"] = (req as any).protocol || "http";
    outHeaders["x-request-id"] =
      (req as any).id ||
      (Array.isArray(req.headers["x-request-id"])
        ? req.headers["x-request-id"][0]
        : (req.headers["x-request-id"] as string)) ||
      "";

    // ── Upstream dispatch (streaming) ────────────────────────────────────────
    const urlObj = new URL(targetUrl);
    const agent = urlObj.protocol === "https:" ? https : http;

    // WHY: Native http(s) keeps us lean, zero-copy streaming, and avoids importing axios here.
    const upstreamReq = agent.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        method: req.method,
        path: urlObj.pathname + urlObj.search,
        headers: outHeaders,
        // NOTE: If you need per-upstream keep-alive pools, configure Agent here.
      },
      (upstreamRes) => {
        // Pass through status + headers (minus hop-by-hop).
        const safeHeaders: Record<string, number | string | string[]> = {};
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (!k) continue;
          if (hop.has(k.toLowerCase())) continue;
          if (v !== undefined) safeHeaders[k] = v as any;
        }
        res.writeHead(upstreamRes.statusCode || 502, safeHeaders);

        // Stream the response back to the client.
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
      // WHY: Map common network errors to useful gateway statuses.
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
      // Headers already sent: attempt a clean close.
      try {
        res.end();
      } catch {
        /* ignore */
      }
    });

    // Stream request body to upstream. No buffering, no size copies here.
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

// ──────────────────────────────────────────────────────────────────────────────
// Helpers — kept local to avoid barrels/shims (SOP)

function resolveSlug(seg: string): string {
  // WHY: aliasing + naive singularization keeps URLs ergonomic but consistent.
  const lower = String(seg || "").toLowerCase();
  const aliased = (ROUTE_ALIAS as Record<string, string>)[lower] || lower;
  return aliased.endsWith("s") ? aliased.slice(0, -1) : aliased;
}

function getService(slug: string): ServiceConfig | undefined {
  // WHY: only proxy to services that are explicitly enabled and allowProxy=true.
  const snap = getSvcconfigSnapshot();
  if (!snap) return undefined;
  const cfg = snap.services[slug];
  if (!cfg) return undefined;
  if (cfg.enabled !== true) return undefined;
  if (cfg.allowProxy !== true) return undefined;
  return cfg;
}

function upstreamBase(cfg: ServiceConfig): string {
  // WHY: workers expose their API under an explicit prefix; default to /api.
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
