// backend/services/auth/src/controllers/auth.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0005 (Gateway→Auth→User Signup Plumbing — mocked hash)
 *
 * Purpose:
 * - POST /api/auth/v1/create
 * - Uses shared BaseController (via AuthControllerBase) for envelope handling.
 * - Step now: validate + hash password, return normalized payload (no User call yet).
 *
 * Notes:
 * - Password is OUTSIDE the user contract by design.
 */

import type { Request, Response } from "express";
import { AuthControllerBase } from "./auth.base.controller";
import { UserContract } from "@nv/shared/contracts/user.contract";

type CreateEnvelope = {
  user?: unknown; // must conform to UserContract (email required)
  password?: string; // separate from contract
};

export class AuthCreateController extends AuthControllerBase {
  // ⬅️ Make constructible from routes
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: CreateEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        const b = (body || {}) as CreateEnvelope;

        // Validate contract
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

        // Validate password presence (content policy TBD)
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

        // Step 1 output (no User call yet)
        return this.ok(
          200,
          {
            user: user.toJSON(),
            hashedPassword,
            note: "Not forwarded to user yet (step 1).",
          },
          requestId
        );
      }
    );
  }
}
