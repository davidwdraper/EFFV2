// backend/services/gateway/src/middleware/serviceProxy.ts
import type { Request, Response } from "express";
import httpProxy = require("http-proxy"); // CJS import for stable types
import jwt from "jsonwebtoken";

// ──────────────────────────────────────────────────────────────────────────────
// S2S minting (HS256) — per SOP Addendum 2
function mintS2S(opts?: { svc?: string; ttlSec?: number }) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(process.env.S2S_TOKEN_TTL_SEC || "60");
  const exp = now + (opts?.ttlSec ?? ttl);
  const iss = process.env.S2S_JWT_ISSUER || "gateway";
  const aud = process.env.S2S_JWT_AUDIENCE || "internal-services";
  const svc = opts?.svc || "gateway";
  const secret = process.env.S2S_JWT_SECRET!;
  if (!secret) throw new Error("Missing S2S_JWT_SECRET");
  return jwt.sign({ sub: "s2s", iss, aud, iat: now, exp, svc }, secret, {
    algorithm: "HS256",
    noTimestamp: true,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolve upstream base from service name (act -> ACT_SERVICE_URL, etc.)
function resolveWorkerBaseFromSvc(svc: string): {
  envKey: string;
  base: string;
} {
  const key = `${svc.toUpperCase()}_SERVICE_URL`;
  const raw = (process.env as any)[key];
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error(`Upstream not configured for "${svc}" (missing ${key})`);
  }
  const base = raw.replace(/\/+$/, "");
  return { envKey: key, base };
}

// One http-proxy instance
const proxy = httpProxy.createProxyServer({ changeOrigin: true, xfwd: true });

// If Express consumed the body already, replay it downstream.
proxy.on("proxyReq", (proxyReq, req: any) => {
  if (!req || !req.method || ["GET", "HEAD"].includes(req.method)) return;

  let bodyData: Buffer | string | undefined;
  if (req.body instanceof Buffer) bodyData = req.body;
  else if (typeof req.body === "string") bodyData = req.body;
  else if (req.body && Object.keys(req.body).length > 0) {
    bodyData = JSON.stringify(req.body);
    proxyReq.setHeader("Content-Type", "application/json");
  }

  if (bodyData) {
    const len = Buffer.isBuffer(bodyData)
      ? bodyData.length
      : Buffer.byteLength(bodyData);
    proxyReq.setHeader("Content-Length", String(len));
    if (proxyReq.getHeader("transfer-encoding"))
      proxyReq.removeHeader("transfer-encoding");
    proxyReq.write(bodyData);
  }
});

// Bubble proxy errors as Problem+JSON
proxy.on("error", (err, _req, res) => {
  const r = res as any;
  const body = JSON.stringify({
    type: "about:blank",
    title: "Bad Gateway",
    status: 502,
    detail: String((err as any)?.message || err),
  });
  try {
    if (typeof r.writeHead === "function" && !r.headersSent) {
      r.writeHead(502, { "Content-Type": "application/json" });
    }
    r.end(body);
  } catch {
    /* noop */
  }
});

// Optional upstream status log
proxy.on("proxyRes", (proxyRes, req: any) => {
  const log = req?.log || console;
  log.info(
    { upstreamStatus: proxyRes.statusCode },
    "[gateway] service proxy response"
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Public entry — forwards "/<svc>/<rest>" → "<ENV(SVC)_SERVICE_URL>/<rest>"
export function serviceProxy() {
  return (req: Request, res: Response) => {
    const path = req.path || "/";

    // Guard: don’t hijack health/debug/public roots
    if (
      path === "/" ||
      path === "/favicon.ico" ||
      path.startsWith("/health") ||
      path === "/healthz" ||
      path === "/readyz" ||
      path === "/live" ||
      path === "/ready" ||
      path === "/__core" || // 👀 DEBUG
      path === "/__auth" // 👀 DEBUG
    ) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Route not found",
        instance: (req as any).id,
      });
    }

    // Expect "/<svc>/<rest>"
    const m = req.url.match(/^\/?([^/]+)\/(.*)$/);
    if (!m) {
      return res.status(400).json({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "Expected path format: /<service>/<rest>",
        instance: (req as any).id,
      });
    }

    const svc = m[1].toLowerCase();
    const rest = m[2] || "";

    const log = (req as any).log || console;
    log.info({ svc, url: req.url }, "[gateway] service proxy inbound");

    let base: string, envKey: string;
    try {
      const r = resolveWorkerBaseFromSvc(svc);
      envKey = r.envKey;
      base = r.base;
      log.info({ envKey, base }, "[gateway] resolved worker upstream");
    } catch (e) {
      log.warn({ svc, err: String(e) }, "[gateway] missing worker upstream");
      return res.status(502).json({
        type: "about:blank",
        title: "Bad Gateway",
        status: 502,
        detail: String(e instanceof Error ? e.message : e),
        instance: (req as any).id,
      });
    }

    const target = `${base}/${rest}`
      .replace(/\/{2,}/g, "/")
      .replace(":/", "://");
    log.info({ target }, "[gateway] service proxy target");

    // Mint S2S (gateway → worker)
    let s2s: string;
    try {
      s2s = mintS2S({ svc: "gateway" });
    } catch (e) {
      log.error({ err: String(e) }, "[gateway] failed to mint S2S");
      return res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "Failed to mint internal token",
        instance: (req as any).id,
      });
    }

    // Never forward user token to workers
    delete (req.headers as any).authorization;

    proxy.web(req as any, res as any, {
      target,
      headers: { authorization: `Bearer ${s2s}`, "x-s2s-caller": "gateway" },
    });
  };
}
