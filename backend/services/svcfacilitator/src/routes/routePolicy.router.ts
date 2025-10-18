// backend/services/svcfacilitator/src/routes/routePolicy.router.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0038 — Route Policy Gate at Gateway & Facilitator Endpoints
 * - ADR-0019 — Class Routers via RouterBase
 *
 * Purpose:
 * - Versioned, contract-shaped endpoints for RoutePolicy CRUD (mocked, Step #3).
 * - Wiring only; logic lives in the controller. No persistence yet.
 */

import { RouterBase } from "@nv/shared/base/RouterBase";
import { RoutePolicyController } from "../controllers/routePolicy.controller";

export class RoutePolicyRouter extends RouterBase {
  protected configure(): void {
    const c = RoutePolicyController.create(this.service);

    // GET /routePolicy?svcconfigId=...&version=...&method=...&path=...
    this.get("/routePolicy", this.wrap("/routePolicy", c.handleGet()));

    // POST /routePolicy
    this.post("/routePolicy", this.wrap("/routePolicy", c.handleCreate()));

    // PUT /routePolicy/:id
    this.put(
      "/routePolicy/:id",
      this.wrap("/routePolicy/:id", c.handleUpdate())
    );
  }
}
