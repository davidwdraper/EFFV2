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
 * - POST /api/auth/v1/create
 * - Validate + hash password, then CALL User service via facilitator-backed SvcClient.
 * - Pass the upstream envelope through unchanged on success.
 *
 * Notes:
 * - Password is OUTSIDE the user contract by design.
 * - For all auth endpoints (create, signon, changePassword), the User service is called.
 * - SOP alignment: Auth → User uses PUT /api/user/v1/users (plural) for create.
 */

import type { Request, Response } from "express";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";
import type { SvcResponse } from "@nv/shared/svc/types";

type CreateEnvelope = {
  user?: unknown;
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

        // 1) Validate user contract
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

        // 2) Validate password
        const pwd = b.password;
        if (!pwd || typeof pwd !== "string" || !pwd.trim()) {
          return this.fail(
            400,
            "invalid_request",
            "password is required",
            requestId
          );
        }

        // 3) Mock hash (temporary)
        const hashedPassword = `mockhash:${Buffer.from(pwd)
          .toString("base64url")
          .slice(0, 24)}`;

        // 4) Call User service → PUT /api/user/v1/users  (SOP-aligned)
        let upstream: SvcResponse<unknown>;
        try {
          upstream = (await this.callUser(
            "users", // ← plural resource, not "create"
            { user: user.toJSON(), hashedPassword },
            { method: "PUT", requestId } // ← PUT, not POST
          )) as unknown as SvcResponse<unknown>;
        } catch (err: any) {
          return this.fail(
            502,
            "bad_gateway",
            `User upstream error: ${String(
              err?.message || err
            )}. Is User service responding?`,
            requestId
          );
        }

        // 5) Pass upstream envelope unchanged
        return this.passUpstream(upstream as any, requestId);
      }
    );
  }
}
