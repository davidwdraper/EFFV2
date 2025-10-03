// backend/services/user/src/controllers/user.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle PUT /v1/users
 * - S2S-only endpoint invoked by the Auth service to provision a new user.
 *
 * Notes:
 * - Controller inheritance: BaseController <- UserControllerBase <- UserCreateController
 * - Uses base helpers to extract the Auth-provision envelope (user + hashedPassword).
 * - Stub for plumbing: acknowledges acceptance; persistence will be added later.
 * - Not exposed to public clients; guarded at router/middleware level.
 */

import type { Request, Response } from "express";
import {
  UserControllerBase,
  type AuthS2SEnvelope,
} from "./user.base.controller";

export class UserCreateController extends UserControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: AuthS2SEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        // Extract & validate the provisioning envelope via the base helper.
        // - Ensures user payload exists
        // - Ensures hashedPassword is present and in mock format
        const { user, hashedPassword } = this.extractProvisionEnvelope(
          body,
          requestId
        );

        // TODO (implementation):
        // 1) Validate 'user' against UserContract (either here or upstream consistently).
        // 2) Create user record with hashedPassword (no plaintext ever).
        // 3) Return the domain object (sans secrets) with generated _id.
        // 4) Push an audit entry (req.audit) when audit middleware is wired.

        // Stub response to keep plumbing flowing.
        return this.ok(
          202,
          {
            status: "accepted",
            detail: "user.create stub — persistence not implemented",
            echo: { user, hashedPasswordPresent: !!hashedPassword },
          },
          requestId
        );
      }
    );
  }
}
