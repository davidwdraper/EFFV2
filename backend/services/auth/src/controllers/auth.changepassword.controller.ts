// backend/services/auth/src/controllers/auth.changepassword.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - POST /api/auth/v1/changepassword
 * - Derives from shared BaseController (via AuthControllerBase) for envelope handling.
 * - Skeleton: validate contract + old/new passwords; no persistence yet.
 */

import type { Request, Response } from "express";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type ChangePasswordEnvelope = {
  user?: unknown; // must conform to UserContract (email required)
  oldPassword?: string; // separate from contract
  newPassword?: string; // separate from contract
};

export class AuthChangePasswordController extends AuthControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: ChangePasswordEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        const b = (body || {}) as ChangePasswordEnvelope;

        // Validate user contract
        let user: UserContract;
        try {
          user = UserContract.from(b.user);
        } catch (e: any) {
          return this.fail(
            400,
            "invalid_user_contract",
            String(e?.message || e),
            requestId
          );
        }

        // Validate passwords
        const oldPwd =
          typeof b.oldPassword === "string" ? b.oldPassword.trim() : "";
        const newPwd =
          typeof b.newPassword === "string" ? b.newPassword.trim() : "";

        if (!oldPwd || !newPwd) {
          return this.fail(
            400,
            "invalid_request",
            "oldPassword and newPassword are required",
            requestId
          );
        }
        if (oldPwd === newPwd) {
          return this.fail(
            400,
            "invalid_request",
            "newPassword must differ from oldPassword",
            requestId
          );
        }

        // Skeleton response — no persistence yet
        return this.ok(
          200,
          {
            email: user.email,
            changed: true,
            note: "ChangePassword skeleton; no persistence/minting implemented yet.",
          },
          requestId
        );
      }
    );
  }
}
