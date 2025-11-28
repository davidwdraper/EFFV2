// backend/services/gateway/src/routes/gateway.route.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Wire the gateway proxy controller to all non-health routes under `/api`.
 * - Paths are relative to `/api` (mounted in app.ts).
 *
 * Invariants:
 * - Health/env reload are mounted separately by AppBase under `/api/gateway/v1/*`.
 * - All other traffic is routed here and proxied to worker services.
 */

import { Router } from "express";
import type { AppBase } from "@nv/shared/base/app/AppBase";
import { GatewayProxyController } from "../controllers/proxy.controller/proxy.controller";

export function buildGatewayRouter(app: AppBase): ReturnType<typeof Router> {
  const r = Router();

  const proxyCtl = new GatewayProxyController(app);

  // Proxy everything that looks like a versioned service path:
  //   /api/:targetSlug/v:targetVersion/*
  r.all("/:targetSlug/v:targetVersion/*", (req, res) =>
    proxyCtl.handle(req, res)
  );

  return r;
}
