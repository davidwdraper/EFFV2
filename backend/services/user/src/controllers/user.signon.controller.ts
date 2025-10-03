// backend/services/user/src/controllers/user.signon.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle POST /v1/signon
 * - S2S-only endpoint invoked by the Auth service.
 *
 * Notes:
 * - Controller inheritance: BaseController <- UserControllerBase <- UserSignonController
 * - Uses UserControllerBase helpers to extract and validate the hashed-password envelope.
 * - Stub for now: responds 501 (not implemented). Repo lookup + hash verify to be added later.
 */

import type { Request, Response } from "express";
import {
  UserControllerBase,
  type AuthS2SEnvelope,
} from "./user.base.controller";

export class UserSignonController extends UserControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: AuthS2SEnvelope; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        // Validate envelope and ensure hashedPassword uses our mock format
        try {
          // For signon, we at least need an identifying subset of "user" (e.g., email) and a hashedPassword.
          // Base extracts and validates presence + mock hash format.
          const { user, hashedPassword } = this.extractProvisionEnvelope(
            body,
            requestId
          );

          // TODO (implementation):
          // 1) Load stored user by unique identifier (e.g., email) from repo.
          // 2) Compare provided hash vs stored hash using this.compareHashed().
          // 3) Return domain user (minus secrets) or failure.
          // For now, just acknowledge the stub with explicit 501.
          return this.fail(
            501,
            "not_implemented",
            "signon stub — repository lookup and hash verification not implemented",
            requestId
          );
        } catch (e) {
          // extractProvisionEnvelope throws via this.fail(); just rethrow to keep the same envelope.
          throw e;
        }
      }
    );
  }
}
