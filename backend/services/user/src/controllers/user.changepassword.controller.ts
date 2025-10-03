// backend/services/user/src/controllers/user.changepassword.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle POST /v1/changepassword
 * - S2S-only endpoint invoked by the Auth service.
 *
 * Notes:
 * - Controller inheritance: BaseController <- UserControllerBase <- UserChangePasswordController
 * - Uses base helpers to validate hashed-password fields (mock format for now).
 * - Stub: returns 501 until repo + persistence are wired.
 */

import type { Request, Response } from "express";
import {
  UserControllerBase,
  type AuthS2SEnvelope,
} from "./user.base.controller";

type ChangePasswordEnvelope<TUser = unknown> = {
  user?: TUser; // identifier subset (e.g., email) expected
  oldHashedPassword?: string;
  newHashedPassword?: string;
};

export class UserChangePasswordController extends UserControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: ChangePasswordEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        const env = (body || {}) as ChangePasswordEnvelope;

        // Require identifying user payload
        if (env.user === undefined || env.user === null) {
          return this.fail(
            400,
            "invalid_request",
            "user payload is required",
            requestId
          );
        }

        // Reuse base hashed-password validator for both old and new hashes
        try {
          const oldHash = this.requireHashedPassword(
            { hashedPassword: env.oldHashedPassword } as AuthS2SEnvelope,
            requestId
          );
          const newHash = this.requireHashedPassword(
            { hashedPassword: env.newHashedPassword } as AuthS2SEnvelope,
            requestId
          );

          // Enforce mock hash format for both (temporary)
          if (!this.isMockHash(oldHash) || !this.isMockHash(newHash)) {
            return this.fail(
              400,
              "invalid_request",
              "oldHashedPassword and newHashedPassword must be mock hashes",
              requestId
            );
          }
        } catch (e) {
          // requireHashedPassword already returned a fail() response
          throw e;
        }

        // TODO (implementation):
        // 1) Load user by identifier (e.g., email) from repo.
        // 2) Compare provided oldHashedPassword vs stored hash via this.compareHashed().
        // 3) If match, persist newHashedPassword; return updated domain user (sans secrets).
        // 4) Otherwise, 401 invalid_credentials (no detail leakage).

        return this.fail(
          501,
          "not_implemented",
          "changepassword stub — repository update not implemented",
          requestId
        );
      }
    );
  }
}
