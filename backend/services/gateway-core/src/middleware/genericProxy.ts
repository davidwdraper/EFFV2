// backend/services/gateway-core/src/middleware/genericProxy.ts
import type { Request, Response } from "express";
import httpProxy = require("http-proxy"); // CJS import for solid types
import { resolveUpstreamBase } from "../config";
import { mintS2S } from "../utils/s2s";

const proxy = httpProxy.createProxyServer({ changeOrigin: true, xfwd: true });

// If Express consumed the body, re-send it downstream.
proxy.on("proxyReq", (proxyReq, req: any) => {
  // Only for methods that may have a body
  if (!req || !req.method || ["GET", "HEAD"].includes(req.method)) return;

  // If body is already a buffer/string, pass as-is; else JSON-stringify object.
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
    // Some proxies need this to avoid chunked encoding with fixed length
    if (proxyReq.getHeader("transfer-encoding"))
      proxyReq.removeHeader("transfer-encoding");
    proxyReq.write(bodyData);
  }
});

// Bubble proxy errors as JSON
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
  } catch {}
});

// Optional: log upstream status for debugging
proxy.on("proxyRes", (proxyRes, req: any) => {
  const log = req?.log || console;
  log.info(
    { upstreamStatus: proxyRes.statusCode },
    "[gateway-core] proxy response"
  );
});

export function genericProxy() {
  console.log("[core] genericProxy impl:", __filename);
  return (req: Request, res: Response) => {
    // Mounted at /api — expect /api/<svc>/<rest>
    const m = req.url.match(/^\/?([^/]+)\/(.*)$/);
    if (!m) {
      return res.status(400).json({
        code: "BAD_REQUEST",
        status: 400,
        message: "Expected /api/<svc>/<rest>",
      });
    }

    const svc = m[1].toLowerCase();
    const rest = m[2] || "";

    const log = (req as any).log || console;
    log.info(
      { svc, url: req.url, originalUrl: (req as any).originalUrl || req.url },
      "[gateway-core] inbound"
    );

    // Resolve strict upstream
    let base: string, svcKey: string;
    try {
      const r = resolveUpstreamBase(svc);
      svcKey = r.svcKey;
      base = r.base;
      log.info({ envKey: svcKey, base }, "[gateway-core] resolved upstream");
    } catch (e) {
      log.warn({ svc, err: String(e) }, "[gateway-core] missing upstream env");
      return res.status(502).json({
        type: "about:blank",
        title: "Bad Gateway",
        status: 502,
        detail: `Upstream not configured for "${svc}"`,
      });
    }

    const target = `${base}/${rest}`
      .replace(/\/{2,}/g, "/")
      .replace(":/", "://");
    log.info({ target }, "[gateway-core] proxy enter");

    // Re-mint S2S as gateway-core for the worker
    let s2s: string;
    try {
      s2s = mintS2S({ svc: "gateway-core" });
    } catch (e) {
      log.error({ err: String(e) }, "[gateway-core] failed to mint S2S");
      return res.status(500).json({
        code: "S2S_MINT_FAIL",
        status: 500,
        message: "Failed to mint internal token",
      });
    }

    // Don’t leak caller auth to worker
    delete (req.headers as any).authorization;

    proxy.web(req as any, res as any, {
      target,
      ignorePath: true, // 👈 critical fix: don’t append req.url again
      headers: { authorization: `Bearer ${s2s}` },
    });
  };
}
