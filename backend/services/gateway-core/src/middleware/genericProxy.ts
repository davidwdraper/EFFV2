// backend/services/gateway-core/src/middleware/genericProxy.ts
import type { Request, Response } from "express";
import httpProxy = require("http-proxy"); // CJS import for solid types

import { getSvcconfigSnapshot } from "@eff/shared/src/svcconfig/client";
import type { ServiceConfig } from "@eff/shared/src/contracts/svcconfig.contract";
import { mintS2S } from "../utils/s2s";

const proxy = httpProxy.createProxyServer({ changeOrigin: true, xfwd: true });

// If Express consumed the body, re-send it downstream.
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

    const slug = m[1].toLowerCase();
    const rest = m[2] || "";

    const log = (req as any).log || console;
    log.info(
      {
        svc: slug,
        url: req.url,
        originalUrl: (req as any).originalUrl || req.url,
      },
      "[gateway-core] inbound"
    );

    // Resolve upstream from shared svcconfig snapshot
    const cfg = getService(slug);
    if (!cfg) {
      log.warn({ svc: slug }, "[gateway-core] unknown or disallowed service");
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Unknown or disallowed service",
      });
    }
    const base = upstreamBase(cfg);

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

    const userAssertion =
      (req.headers["x-nv-user-assertion"] as string | undefined) || undefined;

    proxy.web(req as any, res as any, {
      target,
      ignorePath: true,
      headers: {
        authorization: `Bearer ${s2s}`,
        ...(userAssertion ? { "x-nv-user-assertion": userAssertion } : {}),
      },
    });
  };
}

function getService(slug: string): ServiceConfig | undefined {
  const snap = getSvcconfigSnapshot();
  if (!snap) return undefined;
  const cfg = snap.services[slug];
  if (!cfg) return undefined;
  if (!cfg.enabled) return undefined;
  if (!cfg.allowProxy) return undefined;
  return cfg;
}

function upstreamBase(cfg: ServiceConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const apiPrefix = (cfg.outboundApiPrefix || "/api").replace(/^\/?/, "/");
  return `${base}${apiPrefix}`;
}
