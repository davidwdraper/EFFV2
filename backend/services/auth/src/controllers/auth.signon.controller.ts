// backend/services/auth/src/controllers/auth.signon.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *
 * Purpose:
 * - POST /api/auth/v1/signon
 * - Derives from shared BaseController (via AuthControllerBase) for envelope handling.
 * - Skeleton: validate contract + password; no minting yet.
 */

import type { Request, Response } from "express";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type SignonEnvelope = {
  user?: unknown; // must conform to UserContract (email required)
  password?: string; // separate from contract
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
        const pwd = typeof b.password === "string" ? b.password.trim() : "";
        if (!pwd) {
          return this.fail(
            400,
            "invalid_request",
            "password is required",
            requestId
          );
        }

        // Skeleton response — no minting yet
        return this.ok(
          200,
          {
            email: user.email,
            signedIn: false,
            note: "Signon skeleton; token minting not implemented yet.",
          },
          requestId
        );
      }
    );
  }
}
