// backend/services/auth/src/controllers/auth.base.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - Auth layer base controller.
 * - Extends shared BaseController to centralize envelope handling.
 * - Future home for Auth-specific helpers (e.g., S2S calls to User via SvcClient).
 */

import { BaseController } from "@nv/shared/controllers/base.controller";

export abstract class AuthControllerBase extends BaseController {
  protected constructor() {
    super("auth");
  }

  // TODO (next step): add facilitator-backed SvcClient here and helpers like:
  // protected callUser<TReq, TRes>(subpath: string, body: TReq, opts?: {...}): Promise<SvcResponse<TRes>>
  // Then controllers (create/signon/changepassword) will call this helper.
}
