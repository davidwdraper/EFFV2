// PATH: backend/services/gateway/src/handlers/forwardToService.ts

/**
 * Docs:
 * - Gateway forwards /api/:slug.V<version>/* after guardrails via the **shared S2S client**.
 * - Tolerates multiple S2SResponse shapes: {body}|{data}|{payload}|{text}|{buffer}.
 * - ADRs:
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - Keep the edge **thin and consistent**: shared client handles URL resolution,
 *   S2S identity minting (KMS/ES256), and version stamping. No proxy drift.
 * - Normalize upstream responses so clients (smoke/jq) can always expect JSON on errors.
 *
 * Non-negotiables:
 * - Never forward client Authorization. Shared S2S mints upstream identity.
 * - No env fallbacks here (per SOP). We do **not** read downstream timeout envs;
 *   shared S2S has its own validated defaults. If you need a different timeout,
 *   pass it explicitly from a validated config.
 *
 * Notes:
 * - Body is JSON-only by design (routes/api applies a scoped JSON parser).
 * - Single-write discipline: check `headersSent` before writing on all exits.
 * - We forward query via `opts.query` (lets shared client encode safely).
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

/** Normalize headers coming back from S2S into something Express accepts (best-effort). */
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
      // WHY: belt-and-suspenders parsing. Should be rare, but avoids 500 on edge cases.
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

    // Build safe header pass-through (strip client Authorization + hop-by-hop).
    const {
      authorization,
      Authorization,
      host,
      connection,
      "content-length": _cl,
      ...rest
    } = req.headers as Record<string, string | string[] | undefined>;

    // WHY: we do not read env for a downstream timeout. Shared S2S enforces its own
    // validated defaults. If a caller needs a different timeout, thread it in via
    // a validated config and pass `timeoutMs` explicitly.

    const s2sResp = await callBySlug(slug, version, {
      method: req.method,
      // service-local path (no /api prefix); callBySlug will ensure leading slash
      path: restPath,
      query: req.query as Record<string, unknown>,
      headers: {
        // Correlate across hops
        "x-request-id":
          (req as any).id ||
          (req.headers["x-request-id"] as string | undefined),
        // Preserve CT/Accept for upstream content negotiation
        "content-type":
          (req.headers["content-type"] as string | undefined) ||
          "application/json; charset=utf-8",
        accept: req.headers["accept"] as string | undefined,
        // End-user context (if provided)
        "x-nv-user-assertion": req.headers["x-nv-user-assertion"] as
          | string
          | undefined,
        // Remaining safe headers (no Authorization forwarded)
        ...(rest as Record<string, string | undefined>),
      },
      // Router ensures JSON parsing; pass through as-is to avoid double-serialization
      body: (req as any).body,
      // timeoutMs: (omitted intentionally; see note above)
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

      if (typeof bodyRaw === "string") {
        const maybe = tryParseJSON(bodyRaw);
        return maybe !== undefined
          ? res.json(maybe)
          : res.json({ value: bodyRaw }); // WHY: stable JSON shape for string bodies
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

    res.status(problemJson.status || s2sResp.status || 502);
    res.type("application/problem+json");
    return res.json(problemJson);
  } catch (err) {
    if (!res.headersSent) return next(err);
    try {
      res.end();
    } catch {
      /* no-op */
    }
  }
}

export default forwardToService;
