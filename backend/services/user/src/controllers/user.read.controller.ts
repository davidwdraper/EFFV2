// backend/services/user/src/controllers/user.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle GET /v1/users/:id
 * - Read a single user by id (stubbed for now).
 *
 * Notes:
 * - Controller inheritance: BaseController <- UserControllerBase <- UserReadController
 * - No DB yet—returns 501 to indicate not implemented.
 * - Validates :id presence to keep error semantics clean.
 */

import type { Request, Response } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserReadController extends UserControllerBase {
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

        // TODO: repo.getById(id) → return domain object (sans secrets)
        return this.fail(
          501,
          "not_implemented",
          "read stub — repository not implemented",
          requestId
        );
      }
    );
  }
}
