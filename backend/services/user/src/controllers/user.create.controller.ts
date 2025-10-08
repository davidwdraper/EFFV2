// backend/services/user/src/controllers/user.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0021-user-opaque-password-hash
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *
 * Purpose:
 * - Handle S2S user provisioning (Auth → User).
 * - Controllers stay thin: unwrap → validate DTO (shared) → repo → return.
 *
 * Notes:
 * - Endpoint wired at router as PUT /create (S2S-only).
 * - Persistence currently stubbed; returns 202 Accepted.
 */

import type { RequestHandler } from "express";
import {
  UserControllerBase,
  type ProvisionPayload,
} from "./user.base.controller";

export class UserCreateController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for PUT /create (mounted by the S2S router). */
  public create(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;

      type UserPayload = Record<string, unknown>;
      // IMPORTANT: include the generic in the cast to avoid variance error
      const body = (ctx.body ?? {}) as ProvisionPayload<UserPayload>;

      const { user, hashedPassword } =
        this.extractProvisionPayload<UserPayload>(body, requestId);

      // TODO: validate `user` against shared UserContract; persist; return domain with generated _id.
      return {
        status: 202,
        body: {
          ok: true,
          service: this.service,
          requestId,
          data: {
            status: "accepted",
            detail: "user.create stub — persistence not implemented",
            user, // echo (no secrets)
            hashedPasswordPresent: Boolean(hashedPassword),
          },
        },
      };
    });
  }
}
