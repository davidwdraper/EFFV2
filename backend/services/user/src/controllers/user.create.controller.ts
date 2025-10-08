// backend/services/user/src/controllers/user.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *
 * Purpose:
 * - Handle S2S user provisioning (Auth → User).
 * - Exposes an Express handler via ControllerBase.handle().
 *
 * Notes:
 * - Endpoint is wired at router as PUT /create (S2S-only).
 * - Persistence is stubbed for now; returns 202 Accepted.
 */

import type { RequestHandler } from "express";
import {
  UserControllerBase,
  type AuthS2SEnvelope,
} from "./user.base.controller";

export class UserCreateController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for PUT /create (mounted by the S2S router). */
  public create(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;

      // Bind TUser explicitly so TS knows what `.user` should look like.
      type UserPayload = Record<string, unknown>;

      const { user, hashedPassword } =
        this.extractProvisionEnvelope<UserPayload>(
          (ctx.body as Partial<AuthS2SEnvelope<UserPayload>>) ?? {},
          requestId
        );

      // TODO: validate `user` against UserContract; persist; return domain with generated _id.
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
