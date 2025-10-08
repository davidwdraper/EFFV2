// backend/services/auth/src/routes/auth.router.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (ServiceEntrypoint → AppBase → ServiceBase)
 *   - ADR-0019 (Class Routers via RouterBase)
 *
 * Purpose:
 * - Auth v1 router — mounted at /api/auth/v1 (versioned).
 * - Routes are RELATIVE to that base (no "/v1" here).
 *
 * Invariants:
 * - Uses RouterBase verb helpers (no direct express.Router access).
 * - Environment-invariant (no localhost/127.0.0.1/etc).
 * - Wiring:
 *    • create → controller returns an Express RequestHandler (mount directly)
 *    • signon/changepassword → business methods via ControllerBase.handle(ctx→result)
 */

import { RouterBase } from "@nv/shared/base/RouterBase";
import { AuthCreateController } from "../controllers/auth.create.controller";
import { AuthSignonController } from "../controllers/auth.signon.controller";
import { AuthChangePasswordController } from "../controllers/auth.changepassword.controller";

export class AuthRouter extends RouterBase {
  private readonly createCtrl = new AuthCreateController();
  private readonly signonCtrl = new AuthSignonController();
  private readonly changePwCtrl = new AuthChangePasswordController();

  constructor() {
    super({ service: "auth", context: { router: "v1" } });
  }

  protected configure(): void {
    // PUT /create — controller already exposes an Express handler
    this.put("/create", this.createCtrl.create());

    // POST /signon — business method expects HandlerCtx → HandlerResult
    this.post(
      "/signon",
      this.signonCtrl.handle((ctx) => this.signonCtrl.signon(ctx))
    );

    // POST /changepassword — business method expects HandlerCtx → HandlerResult
    this.post(
      "/changepassword",
      this.changePwCtrl.handle((ctx) => this.changePwCtrl.changePassword(ctx))
    );
  }
}

export default AuthRouter;
