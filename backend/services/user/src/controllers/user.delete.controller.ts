// backend/services/user/src/controllers/user.delete.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle DELETE /v1/users/:id (idempotent)
 *
 * Notes:
 * - Exposes .remove() → RequestHandler
 * - Stubbed: returns 501 until repo is wired.
 */
import type { RequestHandler } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserDeleteController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for DELETE /users/:id */
  public remove(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const id = String(ctx.params?.id ?? "").trim();
      if (!id) {
        return this.fail(400, "invalid_request", "id is required", requestId);
      }

      // TODO: repo.delete(id) → return 200 even if already gone (idempotent)
      return this.fail(
        501,
        "not_implemented",
        "delete not implemented",
        requestId
      );
    });
  }
}
