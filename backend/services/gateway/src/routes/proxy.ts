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
 * - Parse slug/version via UrlHelper; forward via shared SvcClient singleton.
 * - Unwrap SvcClient wrapper so the gateway returns the *upstream* envelope.
 */

import type { Request, Response } from "express";
import { Router } from "express";
import { getSvcClient } from "../clients/svcClient";
import { UrlHelper } from "@nv/shared/http/UrlHelper";

export class ApiProxyRouter {
  private readonly r = Router();

  constructor() {
    this.r.all("/*", this.handle.bind(this));
  }

  public router(): Router {
    return this.r;
  }

  private async handle(req: Request, res: Response): Promise<void> {
    let addr;
    try {
      addr = UrlHelper.parseApiPath(req.originalUrl); // preserves query
    } catch (e: any) {
      res.status(400).json({
        ok: false,
        service: "gateway",
        data: { status: "bad_request", detail: String(e?.message || e) },
      });
      return;
    }

    const isHealth = addr.subpath.startsWith("/health/");
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
    const resolutionVersion = isHealth ? 1 : (addr.version as number);

    // health: unversioned; normal: versioned
    const path = isHealth
      ? UrlHelper.buildServiceRoute({ ...addr, version: undefined }, undefined)
      : UrlHelper.buildServiceRoute(addr, resolutionVersion);

    try {
      const resp: any = await client.call({
        slug: addr.slug,
        version: resolutionVersion,
        path,
        method: req.method as any,
        headers: {
          "x-request-id": (req.headers["x-request-id"] as string) || "",
          accept: "application/json",
        },
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : (req.body as unknown),
      });

      // ---- Unwrap SvcClient wrapper to upstream envelope -------------------
      // SvcClient typically returns: { ok, status, headers, data: <upstream> }
      // We want to return <upstream> as-is if it looks like a service envelope.
      let upstream = resp?.data;
      const looksLikeEnvelope =
        upstream &&
        typeof upstream === "object" &&
        ("ok" in upstream || "service" in upstream || "data" in upstream);

      let outBody: any;
      if (looksLikeEnvelope) {
        outBody = upstream;
      } else if (resp?.body !== undefined) {
        outBody = resp.body;
      } else if (resp?.json !== undefined) {
        outBody = resp.json;
      } else if (resp?.text !== undefined) {
        outBody = String(resp.text);
      } else {
        res.status(502).json({
          ok: false,
          service: "gateway",
          data: {
            status: "bad_gateway",
            detail: "upstream returned no usable body",
          },
        });
        return;
      }

      // ---- Headers: drop hop-by-hop and content-length ---------------------
      const rawHeaders: Record<string, string> = (resp.headers ?? {}) as any;
      const drop = new Set([
        "connection",
        "keep-alive",
        "proxy-connection",
        "transfer-encoding",
        "upgrade",
        "content-length",
      ]);
      const safeHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (!drop.has(k.toLowerCase())) safeHeaders[k] = String(v);
      }

      // Ensure JSON CT if sending an object and CT not already set
      if (
        typeof outBody === "object" &&
        outBody !== null &&
        !Object.keys(safeHeaders).some(
          (h) => h.toLowerCase() === "content-type"
        )
      ) {
        safeHeaders["content-type"] = "application/json; charset=utf-8";
      }

      res
        .status(resp.status ?? 200)
        .set(safeHeaders)
        .send(outBody);
    } catch (err: any) {
      res.status(502).json({
        ok: false,
        service: "gateway",
        data: { status: "bad_gateway", detail: String(err?.message || err) },
      });
    }
  }
}
