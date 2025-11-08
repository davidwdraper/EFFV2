// backend/services/user/src/controllers/user.update.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle PATCH /v1/users/:id (partial update)
 *
 * Notes:
 * - Exposes .update() → RequestHandler
 * - Stubbed: returns 501 until repo is wired.
 */
import type { RequestHandler } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserUpdateController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for PATCH /users/:id */
  public update(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const id = String(ctx.params?.id ?? "").trim();
      if (!id) {
        return this.fail(400, "invalid_request", "id is required", requestId);
      }

      // TODO: validate body against DTO; repo.update(id, dto) → domain object
      return this.fail(
        501,
        "not_implemented",
        "update not implemented",
        requestId
      );
    });
  }
}
