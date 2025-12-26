// backend/services/gateway/src/controllers/proxy.controller/proxy.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *   - ADR-#### (AppBase Optional DTO Registry for Proxy Services)
 *
 * Purpose:
 * - Edge proxy controller for ALL non-health traffic:
 *     /api/:targetSlug/v:targetVersion/*
 * - Extracts proxy context from the inbound HTTP request and delegates to a
 *   single pipeline that calls SvcClient.callRaw().
 *
 * Invariants:
 * - No DTO hydration.
 * - No payload mutation.
 * - Controller seeds proxy context only; handlers perform S2S call + normalization.
 * - Finalization is raw via ControllerGatewayBase:
 *   • Uses ctx["response.status"] and ctx["response.body"] directly.
 *   • Does NOT depend on DtoBag or wire-bag semantics.
 * - Never log raw headers or secret-bearing headers.
 */

import type { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

import { ControllerGatewayBase } from "../../base/ControllerGatewayBase";
import * as GatewayProxyPipeline from "./pipelines/proxy.handlerPipeline";

export class GatewayProxyController extends ControllerGatewayBase {
  private readonly svcClient: SvcClient;

  constructor(app: AppBase) {
    super(app);

    // AppBase owns the SvcClient instance; use the public accessor.
    this.svcClient = app.getSvcClient();
  }

  /** Exposed so handlers can obtain the shared SvcClient instance. */
  public getSvcClient(): SvcClient {
    return this.svcClient;
  }

  public async handle(req: Request, res: Response): Promise<void> {
    const ctx: HandlerContext = this.makeContext(req, res);

    const targetSlug = req.params.targetSlug;
    const targetVersionRaw = req.params.targetVersion;
    const method = req.method.toUpperCase() as
      | "GET"
      | "PUT"
      | "PATCH"
      | "POST"
      | "DELETE";

    // We want the *full* inbound path including `/api/...` so SvcClient.callRaw
    // can simply swap host/port and reuse it.
    const fullPath = req.originalUrl || req.url || req.path;

    // Commit 2: env label is owned by SvcRuntime (via AppBase.getEnvLabel()).
    // No fallbacks; if env is missing, bootstrap must fail before reaching here.
    const envLabel = this.getEnvLabel();

    // Minimal, safe diagnostics: no raw headers, no secrets.
    const requestId = ctx.get<string | undefined>("requestId");
    this.log.debug(
      {
        event: "gateway_proxy_inbound",
        requestId,
        method,
        targetSlug,
        targetVersionRaw,
        fullPath,
        forwardedHeaderKeys: Object.keys(req.headers ?? {}).slice(0, 50),
      },
      "Gateway proxy inbound request"
    );

    ctx.set("proxy.headers", req.headers);
    ctx.set("proxy.slug", targetSlug);
    ctx.set("proxy.version.raw", targetVersionRaw);
    ctx.set("proxy.method", method);
    ctx.set("proxy.env", envLabel);
    ctx.set("proxy.fullPath", fullPath);
    ctx.set("proxy.body", req.body);

    const steps = GatewayProxyPipeline.getSteps(ctx, this);

    await this.runPipeline(ctx, steps, {
      // Gateway proxy does not use DTO registry; it forwards raw JSON.
      requireRegistry: false,
    });

    await this.finalize(ctx);
  }
}
