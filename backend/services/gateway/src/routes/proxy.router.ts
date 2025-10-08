// backend/services/gateway/src/routes/proxy.router.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0003 (Gateway pulls svc map from svcfacilitator)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - Router layer for proxy: matches /api/* (except /api/gateway/*) and delegates to controller.
 */

import type { Request, Response, NextFunction } from "express";
import { RouterBase } from "@nv/shared/base/RouterBase";
import { ProxyController } from "../controllers/proxy.controller";
import type { SvcConfig } from "../services/svcconfig/SvcConfig";

export class ProxyRouter extends RouterBase {
  private readonly controller: ProxyController;

  constructor(svccfg: SvcConfig) {
    super({ service: "gateway", context: { router: "proxy" } });
    this.controller = new ProxyController(svccfg);
  }

  protected preRoute(): void {
    // You can mount pre-routing middleware here if needed (e.g., rate limits).
  }

  protected configure(): void {
    // Route everything under / (the app mounts us at /api).
    // We still short-circuit /api/gateway/* inside the controller to 404/not proxy.
    this.use((req: Request, res: Response, next: NextFunction) =>
      this.controller.handle(req, res, next)
    );
  }

  protected postRoute(): void {
    // Trailing middleware hooks if needed.
  }
}
