// backend/services/user/src/controllers/user.update.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle PATCH /v1/users/:id
 * - Update a user by id (stubbed for now).
 *
 * Notes:
 * - Controller inheritance: BaseController <- UserControllerBase <- UserUpdateController
 * - No DB yet — returns 501 to indicate not implemented.
 * - Validates :id presence and ensures body is a plain object.
 */

import type { Request, Response } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserUpdateController extends UserControllerBase {
  public constructor() {
    super();
  }

  public async handle(req: Request, res: Response): Promise<void> {
    return super.handle<{ body: unknown; requestId: string }>(
      req,
      res,
      async ({ body, requestId }) => {
        const id = String(req.params?.id || "").trim();
        if (!id) {
          return this.fail(400, "invalid_request", "id is required", requestId);
        }

        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          return this.fail(
            400,
            "invalid_request",
            "body must be an object",
            requestId
          );
        }

        // TODO: repo.update(id, body) → return updated domain object (sans secrets)
        return this.fail(
          501,
          "not_implemented",
          "update stub — repository not implemented",
          requestId
        );
      }
    );
  }
}
