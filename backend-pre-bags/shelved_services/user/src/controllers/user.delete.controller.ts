// backend/services/user/src/controllers/user.delete.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0021-user-opaque-password-hash
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *
 * Purpose:
 * - Delete handlers for the User service.
 * - Exposes:
 *    • remove()        → CRUD path (client-facing):    DELETE /users/:id
 *    • s2sDeleteById() → S2S-only path (Auth → User):  DELETE /delete/:id
 *
 * Notes:
 * - Both are idempotent by contract; for now they ACK without persistence.
 * - When repo lands, both will call repo.deleteById(id) and still return 200.
 */

import type { RequestHandler } from "express";
import { UserControllerBase } from "./user.base.controller";

export class UserDeleteController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Client-facing CRUD: DELETE /users/:id (mounted by UsersCrudRouter) */
  public remove(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const id = String(ctx.params?.id ?? "").trim();
      if (!id) {
        return this.fail(400, "invalid_request", "id is required", requestId);
      }

      // TODO: repo.deleteById(id) — idempotent
      return {
        status: 200,
        body: {
          ok: true,
          service: this.service,
          requestId,
          data: {
            status: "deleted",
            detail: "CRUD ack — persistence deferred (stabilizing smoke #8)",
            id,
          },
        },
      };
    });
  }

  /** S2S-only: DELETE /delete/:id (mounted by UserS2SRouter) */
  public s2sDeleteById(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const id = String(ctx.params?.id ?? "").trim();
      if (!id) {
        return this.fail(400, "invalid_request", "id is required", requestId);
      }

      // TODO: repo.deleteById(id) — idempotent
      return {
        status: 200,
        body: {
          ok: true,
          service: this.service,
          requestId,
          data: {
            status: "deleted",
            detail: "S2S ack — persistence deferred (stabilizing smoke #8)",
            id,
          },
        },
      };
    });
  }
}
