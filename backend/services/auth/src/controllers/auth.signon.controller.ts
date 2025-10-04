// backend/services/auth/src/controllers/auth.signon.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - Purpose: POST /api/auth/v1/signon (public)
 *   Validate payload, mock-hash, S2S to User:
 *     POST /api/user/v1/signon
 *
 * Notes:
 * - Controllers do NOT know about resolution; base + SvcClient handle it.
 * - Password handled at auth; user service receives hashedPassword only.
 */

import type { Request, Response } from "express";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type SignonEnvelope = {
  user?: unknown; // must include email per UserContract
  password?: string; // plain; we mock-hash for now
};

export class AuthSignonController extends AuthControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: SignonEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        const b = (body || {}) as SignonEnvelope;

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

        return this.passUpstream(upstream as any, requestId);
      }
    );
  }
}
