// PATH: backend/services/gateway/src/handlers/forwardToService.ts
/**
 * Docs:
 * - Gateway forwards /api/:slug.V<version>/* after guardrails via shared S2S client.
 * - Tolerates multiple S2SResponse shapes: {body}|{data}|{payload}|{text}|{buffer}
 *
 * Notes:
 * - Do NOT forward client Authorization. Shared S2S mints upstream identity.
 * - This handler writes exactly once; guards against headers already sent.
 */

import type { Request, Response, NextFunction } from "express";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import type { S2SResponse } from "@eff/shared/src/utils/s2s/httpClient";

// Extract what looks like a printable body from various response shapes.
function pickBody(resp: S2SResponse<unknown>): unknown {
  const r = resp as any;
  if (r.body !== undefined) return r.body;
  if (r.data !== undefined) return r.data;
  if (r.payload !== undefined) return r.payload;
  if (typeof r.text === "string") return r.text;
  if (r.buffer instanceof Uint8Array) return Buffer.from(r.buffer);
  if (Buffer.isBuffer(r.buffer)) return r.buffer;
  return undefined;
}

// Normalize headers coming back from S2S into something Express accepts
function setResponseHeaders(res: Response, headers?: Record<string, unknown>) {
  if (!headers) return;
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) || typeof v === "string" || typeof v === "number") {
      res.setHeader(k, v as any);
    } else {
      res.setHeader(k, String(v));
    }
  }
}

export async function forwardToService(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Parse /api/:slug.:version/* → slug, version, restPath
    const m = req.path.match(/^\/?([^/.]+)\.([^/]+)\/(.*)$/);
    let slug = "";
    let version = "";
    let restPath = "";
    if (m) {
      slug = (m[1] || "").toLowerCase();
      version = m[2] || "";
      restPath = m[3] || "";
    } else {
      const p = (req as any).params || {};
      slug = String(p.slug || "").toLowerCase();
      version = String(p.version || "");
      const base = `/${slug}.${version}/`;
      const idx = req.path.indexOf(base);
      restPath = idx >= 0 ? req.path.slice(idx + base.length) : p[0] || "";
    }

    if (!slug || !version) {
      if (!res.headersSent) {
        res.status(404).json({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Malformed route. Expected /api/<slug>.V<digit>/…",
          instance: (req as any).id,
        });
      }
      return;
    }

    // Build safe header pass-through (strip client Authorization)
    const {
      authorization,
      Authorization,
      host,
      connection,
      "content-length": _cl,
      ...rest
    } = req.headers as Record<string, string | string[] | undefined>;

    const s2sResp = await callBySlug(slug, version, {
      method: req.method,
      path: restPath, // service-local path (no /api prefix)
      query: req.query as Record<string, unknown>,
      headers: {
        "x-request-id":
          (req as any).id ||
          (req.headers["x-request-id"] as string | undefined),
        "content-type": req.headers["content-type"] as string | undefined,
        accept: req.headers["accept"] as string | undefined,
        "x-nv-user-assertion": req.headers["x-nv-user-assertion"] as
          | string
          | undefined,
        ...(rest as Record<string, string | undefined>),
      },
      body: (req as any).body, // now present thanks to scoped JSON parser
      timeoutMs: Number(process.env.TIMEOUT_GATEWAY_MS || 5000),
    });

    if (res.headersSent) return;

    // Write status, headers, body
    res.status(s2sResp.status);
    setResponseHeaders(res, s2sResp.headers as any);

    const body = pickBody(s2sResp);
    if (body === undefined || body === null) {
      return res.end();
    }
    if (Buffer.isBuffer(body)) return res.end(body);
    if (body instanceof Uint8Array) return res.end(Buffer.from(body));
    if (typeof body === "string") return res.send(body);
    return res.json(body);
  } catch (err) {
    if (!res.headersSent) return next(err);
    // If headers already sent (e.g., timeout middleware fired), just end.
    try {
      res.end();
    } catch {
      /* noop */
    }
  }
}

export default forwardToService;
