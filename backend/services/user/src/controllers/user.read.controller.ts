// backend/services/user/src/controllers/user.read.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle GET /v1/users/:id (read by id)
 *
 * Notes:
 * - Exposes .read() → RequestHandler
 * - Stubbed: returns 501 until repo is wired.
 */
import type { RequestHandler } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserReadController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for GET /users/:id */
  public read(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const id = String(ctx.params?.id ?? "").trim();
      if (!id) {
        return this.fail(400, "invalid_request", "id is required", requestId);
      }

      // TODO: repo.findById(id) → domain object (sans secrets)
      return this.fail(
        501,
        "not_implemented",
        "read not implemented",
        requestId
      );
    });
  }
}
