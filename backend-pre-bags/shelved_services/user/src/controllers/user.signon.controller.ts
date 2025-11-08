// backend/services/user/src/controllers/user.signon.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - ADRs:
 *   - adr0021-user-opaque-password-hash
 *
 * Purpose:
 * - Handle POST /v1/signon (S2S-only: Auth → User)
 * - Opaque hashes: no format enforcement; compare equality only (temporary).
 */

import type { RequestHandler } from "express";
import {
  UserControllerBase,
  type ProvisionPayload,
} from "./user.base.controller";

export class UserSignonController extends UserControllerBase {
  public constructor() {
    super();
  }

  /** Express handler for POST /signon (mounted by S2S router). */
  public signon(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;

      type UserPayload = Record<string, unknown>;
      // Explicitly cast with the generic to satisfy TS invariance
      const body = (ctx.body ?? {}) as ProvisionPayload<UserPayload>;

      const { user, hashedPassword } =
        this.extractProvisionPayload<UserPayload>(body, requestId);

      // TODO:
      // 1) Load stored user by identifier (e.g., email) from repo.
      // 2) Compare provided hash vs stored hash using compareOpaqueHash().
      // 3) Return domain user (sans secrets) or 401 invalid_credentials.
      return this.fail(
        501,
        "not_implemented",
        "signon stub — repository lookup and opaque hash compare not implemented",
        requestId
      );
    });
  }
}
