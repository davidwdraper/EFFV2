// backend/services/gateway/src/middleware/proxy.ts
/**
 * Gateway Proxy (origin swap only)
 *
 * Behavior:
 * - Parse /api/<slug>/v<version>/... with UrlHelper.
 * - If slug === "gateway", skip (health/local routes handle it).
 * - Look up baseUrl via gateway's in-memory SvcConfig mirror.
 * - Build upstream = baseUrl + req.originalUrl  (NO path rewrite).
 * - Strip client Authorization; add x-service-name: gateway.
 */

import type { Request, Response, NextFunction } from "express";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { SvcConfig } from "../services/svcconfig/SvcConfig";

const SVC_NAME = (process.env.SVC_NAME || "gateway").trim() || "gateway";

export function makeProxy(svccfg: SvcConfig) {
  return async function proxy(req: Request, res: Response, next: NextFunction) {
    // Only handle canonical API paths
    let slug = "";
    let version = 1;
    try {
      const addr = UrlHelper.parseApiPath(req.originalUrl);
      slug = addr.slug;
      version = addr.version ?? 1;
    } catch {
      return next(); // not an API path we own
    }

    // Never proxy the gateway’s own endpoints (health, local admin, etc.)
    if (slug === "gateway") return next();

    // Resolve target origin from the gateway mirror
    let baseUrl: string;
    try {
      baseUrl = svccfg.getUrlFromSlug(slug, version);
    } catch (e: any) {
      res.status(502).json({
        ok: false,
        service: SVC_NAME,
        data: { status: "bad_gateway", detail: String(e?.message || e) },
      });
      return;
    }

    // Only change origin; keep exact path+query
    const upstream = baseUrl.replace(/\/+$/, "") + req.originalUrl;

    // Forward headers (minus client Authorization/Host)
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      const key = k.toLowerCase();
      if (key === "host" || key === "authorization") continue;
      headers[key] = Array.isArray(v) ? v[0] : String(v);
    }
    headers["x-service-name"] = SVC_NAME;
    headers["accept"] = headers["accept"] || "application/json";

    // Serialize JSON body if present
    let body: BodyInit | undefined;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.is("application/json") && typeof req.body === "object") {
        body = JSON.stringify(req.body);
        headers["content-type"] = "application/json";
      } else if (typeof req.body === "string" || req.body instanceof Buffer) {
        body = req.body as any;
      }
    }

    try {
      const upstreamResp = (await fetch(upstream, {
        method: req.method,
        headers,
        body,
      })) as unknown as globalThis.Response;

      // Mirror status & headers (skip hop-by-hop)
      res.status(upstreamResp.status);
      upstreamResp.headers.forEach((value, key) => {
        if (
          /^transfer-encoding|connection|keep-alive|proxy-connection|upgrade|host$/i.test(
            key
          )
        )
          return;
        res.setHeader(key, value);
      });

      // Pipe body back
      const ct = upstreamResp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const json = await upstreamResp.json().catch(() => undefined);
        if (json === undefined) res.end();
        else res.json(json);
      } else {
        const text = await upstreamResp.text().catch(() => "");
        res.send(text);
      }
    } catch (err) {
      res.status(502).json({
        ok: false,
        service: SVC_NAME,
        data: {
          status: "bad_gateway",
          detail: `proxy fetch failed: ${String(err)}`,
        },
      });
    }
  };
}
