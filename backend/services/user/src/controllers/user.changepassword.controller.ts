// backend/services/user/src/controllers/user.changepassword.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle POST /v1/changepassword (S2S-only: Auth → User)
 *
 * Notes:
 * - Controller inheritance: ControllerBase <- UserControllerBase <- UserChangePasswordController
 * - Exposes a RequestHandler via .changePassword()
 * - Stub: returns 501 until repo + persistence are wired.
 */

import type { RequestHandler } from "express";
import {
  UserControllerBase,
  type AuthS2SEnvelope,
} from "./user.base.controller";

type ChangePasswordEnvelope<TUser = unknown> = {
  user?: TUser; // identifier subset (e.g., email)
  oldHashedPassword?: string;
  newHashedPassword?: string;
};

export class UserChangePasswordController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for POST /changepassword (mounted by S2S router). */
  public changePassword(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;

      const env = (ctx.body || {}) as ChangePasswordEnvelope<
        Record<string, unknown>
      >;

      // Require identifying user payload
      if (env.user === undefined || env.user === null) {
        return this.fail(
          400,
          "invalid_request",
          "user payload is required",
          requestId
        );
      }

      // Validate hashed passwords using base helpers (mock format enforced)
      const oldHash = this.requireHashedPassword(
        { hashedPassword: env.oldHashedPassword } as AuthS2SEnvelope,
        requestId
      );
      const newHash = this.requireHashedPassword(
        { hashedPassword: env.newHashedPassword } as AuthS2SEnvelope,
        requestId
      );

      if (!this.isMockHash(oldHash) || !this.isMockHash(newHash)) {
        return this.fail(
          400,
          "invalid_request",
          "oldHashedPassword and newHashedPassword must be mock hashes",
          requestId
        );
      }

      // TODO:
      // 1) Load user by identifier (e.g., email) from repo.
      // 2) Verify old hash with this.compareHashed().
      // 3) Persist new hash; return updated domain user (sans secrets).
      // 4) If mismatch, return 401 invalid_credentials (no detail leakage).

      return this.fail(
        501,
        "not_implemented",
        "changepassword stub — repository update not implemented",
        requestId
      );
    });
  }
}
