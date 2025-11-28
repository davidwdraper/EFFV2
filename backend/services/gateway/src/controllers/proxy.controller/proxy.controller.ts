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
 * - Controller sets proxy context only; handler performs S2S call.
 */

import type { Request, Response } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";
import type { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

import * as GatewayProxyPipeline from "./pipelines/proxy.handlerPipeline";

export class GatewayProxyController extends ControllerBase {
  private readonly svcClient: SvcClient;

  constructor(app: AppBase) {
    super(app);

    // NOTE:
    // AppBase owns the SvcClient instance; we reach in via `any` here because
    // gateway is the edge special-case that needs S2S wiring.
    // This is intentionally localized to this controller.
    this.svcClient = (app as unknown as { svcClient: SvcClient }).svcClient;
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

    // Everything after `/api/:targetSlug/v:targetVersion/` becomes the pathSuffix.
    // Example: /api/auth/v1/login → pathSuffix = "login"
    //          /api/auth/v1/user/create → "user/create"
    const basePrefix = `/api/${targetSlug}/v${targetVersionRaw}/`;
    const fullPath = req.path.startsWith("/") ? req.path : `/${req.path}`;
    const suffix = fullPath.startsWith(basePrefix)
      ? fullPath.slice(basePrefix.length)
      : "";

    // Derive env label from svcEnv (ADR-0044), but allow handlers to override if needed.
    const svcEnv = ctx.get<EnvServiceDto | undefined>("svcEnv");

    let envLabel = "unknown";
    if (svcEnv) {
      try {
        envLabel = svcEnv.getEnvVar("NV_ENV");
      } catch {
        // leave as "unknown"
      }
    }

    ctx.set("proxy.slug", targetSlug);
    ctx.set("proxy.version.raw", targetVersionRaw);
    ctx.set("proxy.method", method);
    ctx.set("proxy.pathSuffix", suffix);
    ctx.set("proxy.env", envLabel);
    ctx.set("proxy.body", req.body);

    const steps = GatewayProxyPipeline.getSteps(ctx, this);

    await this.runPipeline(ctx, steps, {
      // Gateway proxy does not use DTO registry; it forwards raw JSON.
      requireRegistry: false,
    });

    return super.finalize(ctx);
  }
}
