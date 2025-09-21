// PATH: backend/services/gateway/src/handlers/forwardToService.ts
/**
 * Docs:
 * - Gateway forwards /api/:slug.V<version>/* after guardrails via shared S2S client.
 * - Tolerates multiple S2SResponse shapes: {body}|{data}|{payload}|{text}|{buffer}
 *
 * Notes:
 * - Do NOT forward client Authorization. Shared S2S mints upstream identity.
 * - This handler writes exactly once; guards against headers already sent.
 * - Always emit JSON (Problem+JSON on errors) so callers (smoke/jq) never break.
 */

import type { Request, Response, NextFunction } from "express";
import { callBySlug } from "@eff/shared/src/utils/s2s/callBySlug";
import type { S2SResponse } from "@eff/shared/src/utils/s2s/httpClient";

/** Pick a body-like field from known S2SResponse variants. */
function pickBody(resp: S2SResponse<unknown>): unknown {
  const r: any = resp;
  if (r.body !== undefined) return r.body;
  if (r.data !== undefined) return r.data;
  if (r.payload !== undefined) return r.payload;
  if (typeof r.text === "string") return r.text;
  if (r.buffer instanceof Uint8Array) return Buffer.from(r.buffer);
  if (Buffer.isBuffer(r.buffer)) return r.buffer;
  return undefined;
}

/** Normalize headers coming back from S2S into something Express accepts. */
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

/** Try parse JSON; return undefined if it’s not JSON. */
function tryParseJSON(s: unknown): any | undefined {
  if (typeof s !== "string") return undefined;
  try {
    return s.length ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

/** Wrap non-JSON error text into RFC7807 Problem JSON. */
function problemFromText(status: number, text?: string, instance?: string) {
  const title = status >= 500 ? "Bad Gateway" : "Upstream Error";
  const detail =
    typeof text === "string" && text.trim().length ? text.trim() : undefined;
  return {
    type: "about:blank",
    title,
    status: Number.isFinite(status) ? status : 502,
    detail: detail ?? (status === 504 ? "Timeout" : "Upstream failure"),
    ...(instance ? { instance } : {}),
  };
}

export async function forwardToService(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Prefer the router’s parsed tuple to avoid brittle regexes.
    const parsed = (req as any).parsedApiRoute as
      | { slug: string; version: string; restPath: string }
      | undefined;

    let slug = "";
    let version = "";
    let restPath = "";

    if (parsed && parsed.slug && parsed.version) {
      slug = String(parsed.slug || "").toLowerCase();
      version = String(parsed.version || "");
      restPath = String(parsed.restPath || "");
    } else {
      // Fallback: parse /:slug.:version/* directly from path (rare)
      const m = req.path.match(/^\/?([^/.]+)\.([^/]+)\/(.*)$/);
      if (m) {
        slug = (m[1] || "").toLowerCase();
        version = m[2] || "";
        restPath = m[3] || "";
      }
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

    // Build safe header pass-through (strip client Authorization, hop-by-hop).
    const {
      authorization,
      Authorization,
      host,
      connection,
      "content-length": _cl,
      ...rest
    } = req.headers as Record<string, string | string[] | undefined>;

    // Effective downstream timeout (gateway should be < edge timeout)
    const timeoutMs = Number(process.env.TIMEOUT_GATEWAY_DOWNSTREAM_MS || 6000);

    const s2sResp = await callBySlug(slug, version, {
      method: req.method,
      // service-local path (no /api prefix); callBySlug will ensure leading slash
      path: restPath,
      query: req.query as Record<string, unknown>,
      headers: {
        "x-request-id":
          (req as any).id ||
          (req.headers["x-request-id"] as string | undefined),
        "content-type":
          (req.headers["content-type"] as string | undefined) ||
          "application/json; charset=utf-8",
        accept: req.headers["accept"] as string | undefined,
        "x-nv-user-assertion": req.headers["x-nv-user-assertion"] as
          | string
          | undefined,
        ...(rest as Record<string, string | undefined>),
      },
      body: (req as any).body, // present thanks to scoped JSON parser
      timeoutMs,
    });

    if (res.headersSent) return;

    const rid = (req as any).id as string | undefined;
    const bodyRaw = pickBody(s2sResp);

    // Happy-path: 2xx — mirror upstream headers/body when possible.
    if (s2sResp.status >= 200 && s2sResp.status < 300) {
      res.status(s2sResp.status);
      setResponseHeaders(res, s2sResp.headers as any);

      if (bodyRaw === undefined || bodyRaw === null) return res.end();
      if (Buffer.isBuffer(bodyRaw)) return res.end(bodyRaw);
      if (bodyRaw instanceof Uint8Array) return res.end(Buffer.from(bodyRaw));

      // If upstream gave us string, try parse JSON; otherwise send as JSON string.
      if (typeof bodyRaw === "string") {
        const maybe = tryParseJSON(bodyRaw);
        return maybe !== undefined
          ? res.json(maybe)
          : res.json({ value: bodyRaw });
      }
      return res.json(bodyRaw);
    }

    // Error-path: normalize to Problem+JSON so jq never fails.
    const problemJson =
      typeof bodyRaw === "string"
        ? problemFromText(s2sResp.status || 502, bodyRaw, rid)
        : bodyRaw && typeof bodyRaw === "object"
        ? (bodyRaw as Record<string, any>)
        : problemFromText(s2sResp.status || 502, undefined, rid);

    // Force correct content type for problems.
    res.status(problemJson.status || s2sResp.status || 502);
    res.type("application/problem+json");
    return res.json(problemJson);
  } catch (err) {
    if (!res.headersSent) return next(err);
    try {
      res.end();
    } catch {
      /* noop */
    }
  }
}

export default forwardToService;
