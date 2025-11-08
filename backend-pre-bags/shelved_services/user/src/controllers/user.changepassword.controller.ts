// backend/services/user/src/controllers/user.changepassword.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - ADRs:
 *   - adr0021-user-opaque-password-hash
 *
 * Purpose:
 * - Handle POST /v1/changepassword (S2S-only: Auth → User)
 * - Opaque hashes: ensure non-empty old/new, no format checks.
 */

import type { RequestHandler } from "express";
import { UserControllerBase } from "./user.base.controller";

type ChangePasswordPayload<TUser = unknown> = {
  user?: TUser; // identifier subset (e.g., email)
  oldHashedPassword?: string; // opaque
  newHashedPassword?: string; // opaque
};

export class UserChangePasswordController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for POST /changepassword (mounted by S2S router). */
  public changePassword(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const body = (ctx.body || {}) as ChangePasswordPayload<
        Record<string, unknown>
      >;

      if (body.user === undefined || body.user === null) {
        return this.fail(
          400,
          "invalid_request",
          "user payload is required",
          requestId
        );
      }
      const oldHash = this.requireHashedPassword(
        { hashedPassword: body.oldHashedPassword },
        requestId
      );
      const newHash = this.requireHashedPassword(
        { hashedPassword: body.newHashedPassword },
        requestId
      );

      // TODO:
      // 1) Load user by identifier from repo.
      // 2) Verify old hash vs stored hash with compareOpaqueHash().
      // 3) Persist new hash; return updated domain user (sans secrets).
      // 4) If mismatch, return 401 invalid_credentials.

      return this.fail(
        501,
        "not_implemented",
        "changepassword stub — repository update not implemented",
        requestId
      );
    });
  }
}
