// backend/services/auth/src/controllers/auth.changepassword.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - Purpose: POST /api/auth/v1/changepassword (public)
 *   Validate payload, hash new password (mock for now), S2S to User:
 *     POST /api/user/v1/changepassword
 */

import type {
  HandlerCtx,
  HandlerResult,
} from "@nv/shared/base/controller/ControllerBase";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type ChangePasswordEnvelope = {
  user?: unknown; // must include email per UserContract
  newPassword?: string; // plain; we hash here (mock for now)
};

export class AuthChangePasswordController extends AuthControllerBase {
  public constructor() {
    super();
  }

  /** Route handler (business): wire with ctrl.handle((ctx) => ctrl.changePassword(ctx)) */
  public async changePassword(ctx: HandlerCtx): Promise<HandlerResult> {
    const { body, requestId } = ctx;
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

    // Mock hash (placeholder until real KDF): opaque to User
    const hashedPassword = `mockhash:${Buffer.from(pwd)
      .toString("base64url")
      .slice(0, 24)}`;

    // S2S: POST /api/user/v1/changepassword
    const upstream = await this.callUserAuth(
      "changepassword",
      { user: user.toJSON(), hashedPassword },
      { requestId }
    );

    return this.fromUpstream(upstream);
  }
}
