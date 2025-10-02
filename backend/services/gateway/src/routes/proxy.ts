// backend/services/gateway/src/routes/proxy.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Generic pass-through proxy: /api/<slug>/v<#>/... (STRICT)
 * - Exception: health is unversioned: /api/<slug>/health/{live,ready}
 * - Parse ONLY (slug/version) via UrlHelper. Do NOT rebuild paths.
 * - Outbound URL = svcconfig baseUrl + exact inbound URL (path + query).
 *
 * Debug (temp):
 * - Log baseUrl, downstreamPath, and finalUrl to catch mismatches fast.
 */

import type { Request, Response } from "express";
import { Router } from "express";
import { getSvcClient } from "../clients/svcClient";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { getSvcConfig } from "../services/svcconfig"; // DEBUG: to log baseUrl

export class ApiProxyRouter {
  private readonly r = Router();

  constructor() {
    this.r.all("/*", this.handle.bind(this));
  }

  public router(): Router {
    return this.r;
  }

  private isHealthSubpath(subpath: string): boolean {
    return (
      subpath === "/health" ||
      subpath === "/health/" ||
      subpath.startsWith("/health/")
    );
  }

  private async handle(req: Request, res: Response): Promise<void> {
    let addr;
    try {
      addr = UrlHelper.parseApiPath(req.originalUrl); // includes query
    } catch (e: any) {
      res.status(400).json({
        ok: false,
        service: "gateway",
        data: { status: "bad_request", detail: String(e?.message || e) },
      });
      return;
    }

    const isHealth = this.isHealthSubpath(addr.subpath);
    if (!isHealth && addr.version === undefined) {
      res.status(400).json({
        ok: false,
        service: "gateway",
        data: {
          status: "bad_request",
          detail: "API version required: /api/<slug>/v<#>/...",
        },
      });
      return;
    }

    const client = getSvcClient();
    const version = isHealth ? 1 : (addr.version as number);

    // EXACT inbound path+query after the port
    const downstreamPath = req.originalUrl;

    // DEBUG: compute and log the final URL we expect SvcClient to hit
    try {
      const baseUrl = getSvcConfig().getUrlFromSlug(addr.slug, version);
      const finalUrl =
        baseUrl.replace(/\/+$/, "") + "/" + downstreamPath.replace(/^\/+/, "");
      // Minimal structured log
      console.log(
        JSON.stringify({
          level: 20,
          service: "gateway",
          msg: "proxy_debug",
          slug: addr.slug,
          version,
          baseUrl,
          downstreamPath,
          finalUrl,
        })
      );
    } catch (e) {
      // If svcconfig can’t resolve, let the SvcClient path handle the error below
    }

    const requestId = req.header("x-request-id") || undefined;
    const auth = req.header("authorization");
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-api-version": String(version),
      ...(auth ? { authorization: auth } : {}),
    };

    try {
      const resp = await client.call({
        slug: addr.slug,
        version,
        path: downstreamPath, // includes query
        method: req.method as any,
        requestId,
        headers,
        // no query here; it’s already in originalUrl
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : (req.body as unknown),
      });

      if (resp.ok && resp.data !== undefined) {
        res
          .status(resp.status)
          .set(resp.headers)
          .send(resp.data as any);
        return;
      }

      res.status(resp.status || 502).json({
        ok: false,
        service: "gateway",
        data: {
          status: "bad_gateway",
          detail: resp.error?.message || "upstream error",
        },
      });
    } catch (err: any) {
      res.status(502).json({
        ok: false,
        service: "gateway",
        data: { status: "bad_gateway", detail: String(err?.message || err) },
      });
    }
  }
}
