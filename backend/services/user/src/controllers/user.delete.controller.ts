// backend/services/user/src/controllers/user.delete.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle DELETE /v1/users/:id
 * - Delete a user by id (idempotent).
 *
 * Notes:
 * - Controller inheritance: BaseController <- UserControllerBase <- UserDeleteController
 * - Stub only for now: returns 501 not implemented.
 * - Validates :id presence for proper error semantics.
 */

import type { Request, Response } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserDeleteController extends UserControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ requestId: string }>(
      req,
      res,
      async ({ requestId }) => {
        const id = String(req.params?.id || "").trim();
        if (!id) {
          return this.fail(400, "invalid_request", "id is required", requestId);
        }

        // TODO: repo.delete(id) → confirm deletion / idempotent return
        return this.fail(
          501,
          "not_implemented",
          "delete stub — repository not implemented",
          requestId
        );
      }
    );
  }
}
