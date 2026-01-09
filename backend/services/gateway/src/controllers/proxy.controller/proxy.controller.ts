// backend/services/gateway/src/controllers/proxy.controller/proxy.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *   - ADR-0084 (Service Posture & Boot-Time Rails)
 *   - ADR-#### (Gateway Proxy Client Fast Path)
 *
 * Purpose:
 * - Edge proxy controller for ALL non-gateway-owned traffic:
 *     /api/:targetSlug/v:targetVersion/*
 *
 * Invariants:
 * - Gateway is a proxy: no DTO registry, no DTO hydration, no HandlerBase pipelines.
 * - Outbound path MUST match inbound path exactly (only host/port differs).
 * - Never log raw header values or secret-bearing headers.
 */

import type { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { GatewayProxyClient } from "../../proxy/GatewayProxyClient";

type HttpMethod = "GET" | "PUT" | "PATCH" | "POST" | "DELETE";

function asHttpMethod(x: string): HttpMethod {
  const up = x.toUpperCase();
  if (
    up === "GET" ||
    up === "PUT" ||
    up === "PATCH" ||
    up === "POST" ||
    up === "DELETE"
  )
    return up;
  throw new Error(`GATEWAY_UNSUPPORTED_METHOD: method="${x}"`);
}

function parseMajorVersion(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`GATEWAY_INVALID_TARGET_VERSION: raw="${raw}"`);
  return n;
}

function firstHeader(h: string | string[] | undefined): string | undefined {
  if (!h) return undefined;
  return Array.isArray(h) ? h[0] : h;
}

function ensureRequestId(req: Request): string {
  const existing = firstHeader(req.headers["x-request-id"] as any);
  if (existing && existing.trim()) return existing.trim();
  return `gw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeInboundHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (v === undefined) continue;
    const s = firstHeader(v as any);
    if (s === undefined) continue;
    out[k.toLowerCase()] = String(s);
  }
  return out;
}

export class GatewayProxyController {
  private readonly app: AppBase;
  private readonly proxyClient: GatewayProxyClient;

  constructor(app: AppBase) {
    this.app = app;
    this.proxyClient = new GatewayProxyClient({
      svcClient: app.getSvcClient(),
    });
  }

  public async handle(req: Request, res: Response): Promise<void> {
    const targetSlug = req.params.targetSlug;
    const targetVersion = parseMajorVersion(req.params.targetVersion);
    const method = asHttpMethod(req.method);

    const fullPath = req.originalUrl || req.url || req.path; // MUST include /api/...

    const envLabel = this.app.getEnvLabel();
    const requestId = ensureRequestId(req);
    const headers = normalizeInboundHeaders(req);

    this.app.getLogger().debug(
      {
        event: "gateway_proxy_inbound",
        requestId,
        method,
        targetSlug,
        targetVersion,
        fullPath,
        env: envLabel,
        headerKeys: Object.keys(req.headers ?? {}).slice(0, 80),
      },
      "Gateway proxy inbound"
    );

    try {
      const out = await this.proxyClient.proxy({
        env: envLabel,
        slug: targetSlug,
        version: targetVersion,
        method,
        fullPath,
        requestId,
        headers,
        body: req.body,
      });

      // Pass through status/bodyText. Keep it simple.
      res.status(out.status);

      const ct = out.headers?.["content-type"];
      if (ct) res.setHeader("Content-Type", ct);

      // Body is raw text from FetchSvcClientTransport.
      // If upstream returned JSON, it is already JSON text.
      if (!out.bodyText) {
        res.end();
        return;
      }

      res.send(out.bodyText);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      res.status(502).json({
        httpStatus: 502,
        title: "gateway_proxy_failed",
        detail: msg,
        requestId,
        origin: {
          service: "gateway",
          controller: "GatewayProxyController",
          op: "proxy",
        },
      });
    }
  }
}
