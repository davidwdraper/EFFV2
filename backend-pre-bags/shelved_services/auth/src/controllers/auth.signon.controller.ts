// backend/services/auth/src/controllers/auth.signon.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - Purpose: POST /api/auth/v1/signon (public)
 *   Validate payload, hash (mock for now), S2S to User:
 *     POST /api/user/v1/signon
 */

import type {
  HandlerCtx,
  HandlerResult,
} from "@nv/shared/base/controller/ControllerBase";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type SignonEnvelope = {
  user?: unknown; // must include email per UserContract
  password?: string; // plain; we hash here (mock for now)
};

export class AuthSignonController extends AuthControllerBase {
  public constructor() {
    super();
  }

  /** Route handler (business): wire with ctrl.handle((ctx) => ctrl.signon(ctx)) */
  public async signon(ctx: HandlerCtx): Promise<HandlerResult> {
    const { body, requestId } = ctx;
    const b = (body || {}) as SignonEnvelope;

    // Validate user
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

    // Validate password
    const pwd = b.password;
    if (!pwd || typeof pwd !== "string" || !pwd.trim()) {
      return this.fail(
        400,
        "invalid_request",
        "password is required",
        requestId
      );
    }

    // Mock hash (placeholder)
    const hashedPassword = `mockhash:${Buffer.from(pwd)
      .toString("base64url")
      .slice(0, 24)}`;

    // S2S: POST /api/user/v1/signon
    const upstream = await this.callUserAuth(
      "signon",
      { user: user.toJSON(), hashedPassword },
      { requestId }
    );

    return this.fromUpstream(upstream);
  }
}
