// backend/services/auth/src/controllers/auth.changepassword.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - Purpose: POST /api/auth/v1/changepassword (public)
 *   Validate payload, mock-hash new password, S2S to User:
 *     POST /api/user/v1/changepassword
 *
 * Minimal contract (for now):
 * - Identify user by email (via UserContract).
 * - Provide newPassword (plain); we send hashedPassword to User.
 */

import type { Request, Response } from "express";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type ChangePasswordEnvelope = {
  user?: unknown; // must include email per UserContract
  newPassword?: string; // plain; we mock-hash for now
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

        // Validate user (email required)
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

        // Validate newPassword
        const pwd = b.newPassword;
        if (!pwd || typeof pwd !== "string" || !pwd.trim()) {
          return this.fail(
            400,
            "invalid_request",
            "newPassword is required",
            requestId
          );
        }

        // Mock hash (placeholder)
        const hashedPassword = `mockhash:${Buffer.from(pwd)
          .toString("base64url")
          .slice(0, 24)}`;

        // S2S: POST /api/user/v1/changepassword
        const upstream = await this.callUserAuth(
          "changepassword",
          { user: user.toJSON(), hashedPassword },
          { requestId }
        );

        return this.passUpstream(upstream as any, requestId);
      }
    );
  }
}
