// backend/services/auth/src/controllers/auth.create.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0005 (Gateway→Auth→User Signup Plumbing — mocked hash)
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache)
 *
 * Purpose:
 * - POST /api/auth/v1/create (public)
 * - Validate + hash password (mock for now), then CALL User:
 *     PUT /api/user/v1/create (S2S)
 */

import type { HandlerCtx, HandlerResult } from "@nv/shared/base/ControllerBase";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type CreateEnvelope = {
  user?: unknown; // must conform to UserContract (email required)
  password?: string;
};

export class AuthCreateController extends AuthControllerBase {
  public constructor() {
    super();
  }

  /** Route handler (business): wire with ctrl.handle((ctx) => ctrl.create(ctx)) */
  public async create(ctx: HandlerCtx): Promise<HandlerResult> {
    const { body, requestId } = ctx;
    const b = (body || {}) as CreateEnvelope;

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

    // Mock hash — replace with real crypto per future ADR
    const hashedPassword = `mockhash:${Buffer.from(pwd)
      .toString("base64url")
      .slice(0, 24)}`;

    // S2S: PUT /api/user/v1/create
    const upstream = await this.callUser(
      "create",
      { user: user.toJSON(), hashedPassword },
      { method: "PUT", requestId }
    );

    return this.fromUpstream(upstream);
  }
}
