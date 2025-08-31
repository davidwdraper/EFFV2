// backend/services/gateway/src/middleware/serviceProxy.ts
import type { Request, Response, NextFunction } from "express";
import type { IncomingHttpHeaders } from "http";
import httpProxy from "http-proxy";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { logger as sharedLogger } from "@shared/utils/logger";
import { serviceName } from "../config";

/**
 * Service Proxy (Gateway → Worker)
 *
 * Hard rule: inbound must be `/api/<service>/<rest>` (health endpoints excluded elsewhere).
 * Mapping:
 *   /api/<service>/<rest>  →  <SERVICE_URL><OUTBOUND_API_PREFIX>/<rest>
 *
 * Required env (NO fallbacks):
 *   INBOUND_STRIP_SEGMENTS=1
 *   OUTBOUND_API_PREFIX=/api      # workers serve under /api
 *   S2S_SECRET
 *   S2S_ISSUER
 *   S2S_AUDIENCE
 *   S2S_MAX_TTL_SEC
 */

const logger = sharedLogger.child({
  service: serviceName,
  scope: "serviceProxy",
});

// ── required config ───────────────────────────────────────────────────────────
function requireIntEnv(name: string, min = 0) {
  const v = process.env[name];
  if (v === undefined) throw new Error(`${name} must be set`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < min)
    throw new Error(`${name} must be >= ${min}`);
  return n;
}
function requireStrEnvAllowEmpty(name: string) {
  if (!(name in process.env))
    throw new Error(`${name} must be set (can be empty)`);
  return String(process.env[name] ?? "");
}
function requireStrEnv(name: string) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === "")
    throw new Error(`${name} must be set`);
  return String(v).trim();
}

const INBOUND_STRIP_SEGMENTS = requireIntEnv("INBOUND_STRIP_SEGMENTS", 1);
const OUTBOUND_API_PREFIX = requireStrEnvAllowEmpty("OUTBOUND_API_PREFIX");
const S2S_SECRET = requireStrEnv("S2S_SECRET");
const S2S_ISSUER = requireStrEnv("S2S_ISSUER");
const S2S_AUDIENCE = requireStrEnv("S2S_AUDIENCE");
const S2S_MAX_TTL_SEC = requireIntEnv("S2S_MAX_TTL_SEC", 1);

// ── helpers ───────────────────────────────────────────────────────────────────
function resolveUpstreamBase(serviceSeg: string): string {
  const envKey = `${serviceSeg.toUpperCase()}_SERVICE_URL`;
  const val = process.env[envKey];
  if (!val || !String(val).trim())
    throw new Error(`Missing upstream URL: ${envKey}`);
  return String(val).trim().replace(/\/+$/, "");
}

function mintS2S(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: S2S_ISSUER,
      aud: S2S_AUDIENCE,
      sub: "service:gateway",
      iat: now,
      exp: now + S2S_MAX_TTL_SEC,
      jti: randomUUID(),
      scope: "s2s",
    },
    S2S_SECRET,
    { algorithm: "HS256" }
  );
}

function toStringHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(",");
  }
  return out;
}

function joinPath(...parts: string[]): string {
  const cleaned = parts
    .filter((p) => p != null)
    .map((p) => String(p))
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p !== "");
  const joined = cleaned.join("/");
  return joined ? `/${joined}` : "/";
}

// ── proxy instance ────────────────────────────────────────────────────────────
export function serviceProxy() {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    ignorePath: true,
    selfHandleResponse: false,
    preserveHeaderKeyCase: true,
  });

  proxy.on("error", (err, req, res) => {
    const rid = String((req as any).headers?.["x-request-id"] || "");
    logger.debug(
      {
        sentinel: "500DBG",
        where: "proxy.on(error)",
        rid,
        err: String((err as any)?.message || err),
      },
      "500 about to be sent <<<500DBG>>>"
    );
    const resp = res as Response;
    if (!resp.headersSent) {
      resp.status(500).json({
        type: "about:blank",
        title: "Proxy Error",
        status: 500,
        detail: String((err as any)?.message || err),
      });
    }
  });

  proxy.on("proxyReq", (proxyReq, req) => {
    const rid = String((req as any).headers?.["x-request-id"] || "");
    logger.debug(
      {
        rid,
        method: (req as Request).method,
        originalUrl: (req as Request).originalUrl,
        targetPath: (proxyReq as any)?.path,
        outHeaders: (proxyReq as any).getHeaders?.(),
      },
      "proxyReq"
    );
  });

  proxy.on("proxyRes", (proxyRes, req) => {
    const rid = String((req as any).headers?.["x-request-id"] || "");
    const status = proxyRes.statusCode || 0;
    if (status >= 400) {
      const chunks: Buffer[] = [];
      let total = 0;
      const limit = 4096;
      proxyRes.on("data", (c: Buffer) => {
        if (total < limit) {
          const slice = c.subarray(0, Math.min(c.length, limit - total));
          chunks.push(slice);
          total += slice.length;
        }
      });
      proxyRes.on("end", () => {
        const bodyPreview = Buffer.concat(chunks, total).toString("utf8");
        logger.debug(
          {
            rid,
            where: "proxyRes>=400",
            upstreamStatus: status,
            upstreamHeaders: proxyRes.headers,
            bodyPreview,
          },
          "Upstream error"
        );
      });
    } else {
      logger.debug(
        {
          rid,
          where: "proxyRes<400",
          upstreamStatus: status,
          upstreamHeaders: proxyRes.headers,
        },
        "Upstream ok"
      );
    }
  });

  // ── middleware ──────────────────────────────────────────────────────────────
  return function serviceProxyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const rid = String(req.headers["x-request-id"] || "");
    const rawUrl = req.originalUrl || req.url || "/";

    try {
      // Parse path + assert /api/<service>/...
      const qPos = rawUrl.indexOf("?");
      const pathOnly = qPos >= 0 ? rawUrl.slice(0, qPos) : rawUrl; // e.g. /api/act/acts
      const query = qPos >= 0 ? rawUrl.slice(qPos) : "";
      const segments = pathOnly.replace(/^\/+/, "").split("/"); // ["api","act","acts"]

      // Enforce hard rule: first segment MUST be "api"
      if (segments[0] !== "api") {
        // Let health/other routers handle non-/api paths
        return next();
      }

      // Strip the mandatory "api" head (INBOUND_STRIP_SEGMENTS is asserted to be 1)
      const stripped = segments.slice(INBOUND_STRIP_SEGMENTS); // ["act","acts", ...]
      const [serviceSeg, ...rest] = stripped;
      if (!serviceSeg) return next(); // no service → not our route

      // Resolve upstream base
      let targetBase = "";
      try {
        targetBase = resolveUpstreamBase(serviceSeg);
      } catch (e: any) {
        return res.status(502).json({
          type: "about:blank",
          title: "Bad Gateway",
          status: 502,
          detail: e?.message || "Unknown upstream",
          instance: (req as any).id,
        });
      }

      // Final URL = base + OUTBOUND_API_PREFIX + rest + query
      const pathWithPrefix = joinPath(OUTBOUND_API_PREFIX, rest.join("/"));
      const finalUrl = `${targetBase}${pathWithPrefix}${query}`;

      // Mint S2S
      let s2s = "";
      try {
        s2s = mintS2S();
      } catch (e: any) {
        logger.debug(
          {
            sentinel: "500DBG",
            where: "mintS2S",
            rid,
            err: String(e?.message || e),
          },
          "500 about to be sent <<<500DBG>>>"
        );
        return res.status(503).json({
          type: "about:blank",
          title: "Gateway Auth Misconfigured",
          status: 503,
          detail:
            "S2S mint failed: ensure S2S_SECRET, S2S_ISSUER, S2S_AUDIENCE, S2S_MAX_TTL_SEC are set.",
          instance: (req as any).id,
        });
      }

      // Outbound headers
      const outHeaders = toStringHeaders(req.headers);
      delete outHeaders.authorization; // never forward client token
      delete outHeaders["content-length"];
      delete outHeaders["transfer-encoding"];
      delete outHeaders.host;
      if (outHeaders["accept-encoding"]) delete outHeaders["accept-encoding"];
      outHeaders.authorization = `Bearer ${s2s}`;
      outHeaders["x-request-id"] = rid || randomUUID();

      // Pre-proxy log
      logger.debug(
        {
          where: "pre-proxy",
          rid,
          method: req.method,
          from: rawUrl,
          to: finalUrl,
          stripSegments: INBOUND_STRIP_SEGMENTS,
          outboundPrefix: OUTBOUND_API_PREFIX,
          readableEnded: (req as any).readableEnded,
          outHeaders,
        },
        "About to proxy"
      );

      // Body must be untouched
      if ((req as any).readableEnded === true) {
        logger.debug(
          { sentinel: "500DBG", where: "body-consumed", rid },
          "500 about to be sent <<<500DBG>>>"
        );
        return res.status(500).json({
          type: "about:blank",
          title: "Gateway Misconfiguration",
          status: 500,
          detail:
            "Request body was consumed before proxy. Mount serviceProxy() before any body parsers.",
          instance: (req as any).id,
        });
      }

      // Proxy it
      try {
        proxy.web(
          req,
          res,
          { target: finalUrl, secure: false, headers: outHeaders },
          (err) => {
            logger.debug(
              {
                sentinel: "500DBG",
                where: "proxy.web callback",
                rid,
                err: String((err as any)?.message || err),
              },
              "500 about to be sent <<<500DBG>>>"
            );
            if (!res.headersSent) {
              res.status(500).json({
                type: "about:blank",
                title: "Proxy Error",
                status: 500,
                detail: String((err as any)?.message || err),
                instance: (req as any).id,
              });
            }
          }
        );
      } catch (e: any) {
        logger.debug(
          {
            sentinel: "500DBG",
            where: "proxy.web throw",
            rid,
            err: String(e?.message || e),
          },
          "500 about to be sent <<<500DBG>>>"
        );
        return res.status(500).json({
          type: "about:blank",
          title: "Proxy Error",
          status: 500,
          detail: "proxy invocation failed",
          instance: (req as any).id,
        });
      }
    } catch (e: any) {
      logger.debug(
        {
          sentinel: "500DBG",
          where: "middleware.try/catch",
          err: String(e?.message || e),
        },
        "500 about to be sent <<<500DBG>>>"
      );
      return res.status(500).json({
        type: "about:blank",
        title: "Gateway Error",
        status: 500,
        detail: "Unhandled proxy exception",
        instance: (req as any).id,
      });
    }
  };
}
