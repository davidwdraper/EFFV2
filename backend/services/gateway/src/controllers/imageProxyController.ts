// backend/services/gateway/src/controllers/imageProxyController.ts
import type { RequestHandler } from "express";
import { Readable } from "node:stream";
import { requireUpstream } from "../config";

/**
 * Gateway → Image service proxy.
 * Prefers http-proxy-middleware (zero-copy streaming). Falls back to a manual proxy
 * that correctly bridges Web streams to Node streams—without TS directive comments.
 *
 * NOTE: Ensure your requireUpstream() union includes "IMAGE_SERVICE_URL".
 * Env must provide IMAGE_SERVICE_URL (e.g., http://localhost:4005).
 */

// Lazy-load http-proxy-middleware to avoid ESM/typing headaches when it isn't installed.
let createProxyMiddleware: undefined | ((...args: any[]) => any);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("http-proxy-middleware");
  createProxyMiddleware = (mod.createProxyMiddleware || mod.default) as any;
} catch {
  // Not installed; we'll use the manual proxy below.
}

const target = requireUpstream("IMAGE_SERVICE_URL");

export const proxyImages: RequestHandler = createProxyMiddleware
  ? createProxyMiddleware({
      target,
      changeOrigin: true,
      xfwd: true,
      ws: false,
      preserveHeaderKeyCase: true,
      selfHandleResponse: false, // upstream handles body/headers
      pathRewrite: (path: string) => path, // keep /images prefix intact
      onProxyReq(proxyReq: any, req: any) {
        // Correlation headers
        const rid =
          req.headers["x-request-id"] ||
          req.headers["x-correlation-id"] ||
          req.headers["x-amzn-trace-id"] ||
          req.id;
        if (rid) {
          proxyReq.setHeader("x-request-id", String(rid));
          proxyReq.setHeader("x-correlation-id", String(rid));
        }
        // User context
        const uid =
          req.headers["x-user-id"] || req.user?.id || req.user?._id || "";
        if (uid) proxyReq.setHeader("x-user-id", String(uid));
      },
    })
  : // ---------- Manual proxy fallback (Node 18+ global fetch) ----------
    async (req, res, next) => {
      try {
        const url = new URL(req.originalUrl, target);

        // Build upstream headers (preserve incoming headers)
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "undefined") continue;
          headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
        }

        // Ensure correlation headers
        const rid =
          (req.headers["x-request-id"] as string) ||
          (req.headers["x-correlation-id"] as string) ||
          (req.headers["x-amzn-trace-id"] as string) ||
          (req as any).id;
        if (rid) {
          headers.set("x-request-id", String(rid));
          headers.set("x-correlation-id", String(rid));
        }

        // Propagate user context if present
        const uid =
          (req.headers["x-user-id"] as string) ||
          (req as any).user?.id ||
          (req as any).user?._id;
        if (uid) headers.set("x-user-id", String(uid));

        // Prepare RequestInit without TS directives/comments
        const isBodyless = req.method === "GET" || req.method === "HEAD";
        const init: any = { method: req.method, headers };
        if (!isBodyless) {
          // Express req is a readable stream; Node fetch accepts it with duplex hint
          init.body = req as any;
          // The "duplex" field is not yet in lib.dom.d.ts for Node fetch; keep it as an untyped field
          init.duplex = "half";
        }

        const upstream = await fetch(url, init);

        // Mirror status & headers
        res.status(upstream.status);
        upstream.headers.forEach((val, key) => {
          // Some hop-by-hop headers should not be forwarded
          if (key.toLowerCase() === "transfer-encoding") return;
          res.setHeader(key, val);
        });

        // Stream the body correctly (Web ReadableStream → Node stream)
        const body: any = upstream.body;
        if (!body) {
          res.end();
          return;
        }

        // If the runtime already provides a Node stream, use it; otherwise bridge from Web stream
        const nodeReadable =
          typeof body.pipe === "function" ? body : Readable.fromWeb(body);
        nodeReadable.on("error", next);
        nodeReadable.pipe(res);
      } catch (err) {
        (req as any).log?.error({ err }, "image proxy fallback error");
        next(err);
      }
    };
