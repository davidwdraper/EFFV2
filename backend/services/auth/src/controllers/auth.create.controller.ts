// backend/services/auth/src/controllers/auth.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0005 (Gateway→Auth→User Signup Plumbing — mocked hash)
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache)
 *
 * Purpose:
 * - POST /api/auth/v1/create  (public)
 * - Validate + mock-hash password, then CALL User service:
 *     PUT /api/user/v1/create  (S2S)
 *
 * Notes:
 * - Password is OUTSIDE the user contract by design; we pass hashedPassword to User.
 * - Controllers do not know about svcfacilitator; shared SvcClient handles resolution.
 */

import type { Request, Response } from "express";
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

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: CreateEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        const b = (body || {}) as CreateEnvelope;

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

        // Validate password presence
        const pwd = b.password;
        if (!pwd || typeof pwd !== "string" || !pwd.trim()) {
          return this.fail(
            400,
            "invalid_request",
            "password is required",
            requestId
          );
        }

        // Temporary mock hash — replace with real crypto per future ADR.
        const hashedPassword = `mockhash:${Buffer.from(pwd)
          .toString("base64url")
          .slice(0, 24)}`;

        // S2S per aligned path:
        //   User create = PUT /api/user/v1/create
        const upstream = await this.callUser(
          "create",
          { user: user.toJSON(), hashedPassword },
          { method: "PUT", requestId }
        );

        // Pass upstream envelope (or map to clean bad_gateway on error)
        return this.passUpstream(upstream as any, requestId);
      }
    );
  }
}
