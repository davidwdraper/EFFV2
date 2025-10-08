// backend/services/user/src/controllers/user.signon.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *
 * Purpose:
 * - Handle POST /v1/signon (S2S-only: Auth → User)
 *
 * Notes:
 * - Controller inheritance: ControllerBase <- UserControllerBase <- UserSignonController
 * - Exposes a RequestHandler via .signon() (no legacy (req,res) signatures).
 * - Stub for now: responds 501 (not implemented). Repo lookup + hash verify later.
 */

import type { RequestHandler } from "express";
import {
  UserControllerBase,
  type AuthS2SEnvelope,
} from "./user.base.controller";

export class UserSignonController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for POST /signon (mounted by S2S router). */
  public signon(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;

      // Bind expected payload shape explicitly
      type UserPayload = Record<string, unknown>;
      const { /* user */ _, hashedPassword } =
        this.extractProvisionEnvelope<UserPayload>(
          (ctx.body as Partial<AuthS2SEnvelope<UserPayload>>) ?? {},
          requestId
        );

      // TODO:
      // 1) Load stored user by identifier (e.g., email) from repo.
      // 2) Compare provided hash vs stored hash using this.compareHashed().
      // 3) Return domain user (sans secrets) or 401 invalid_credentials.
      return this.fail(
        501,
        "not_implemented",
        "signon stub — repository lookup and hash verification not implemented",
        requestId
      );
    });
  }
}
