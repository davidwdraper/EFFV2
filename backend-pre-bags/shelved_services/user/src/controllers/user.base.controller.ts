// backend/services/user/src/controllers/user.base.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0021-user-opaque-password-hash
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *
 * Purpose:
 * - Per-service base controller for the User service.
 * - Extends shared ControllerBase and standardizes env-driven service name.
 * - Centralizes tiny helpers (request id, envelope extraction).
 *
 * Notes:
 * - User service treats password hashes as OPAQUE (ADR-0021).
 * - No format checks, no mock-prefix checks here. Auth owns hashing policy.
 */

import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

/** Flat shape controllers should receive AFTER unwrapEnvelope middleware. */
export type ProvisionPayload<TUser = unknown> = {
  user?: TUser; // expected to conform to shared UserContract DTO
  hashedPassword?: string; // opaque non-empty string (ADR-0021)
};

function getSvcName(): string {
  const n = process.env.SVC_NAME?.trim();
  if (!n) throw new Error("SVC_NAME is required but not set");
  return n;
}

export abstract class UserControllerBase extends ControllerBase {
  protected constructor() {
    super({ service: getSvcName() });
  }

  /**
   * Ensure the payload contains a non-empty hashedPassword string.
   * Returns the trimmed hash or throws a 400 HandlerResult.
   */
  protected requireHashedPassword(
    body: ProvisionPayload,
    requestId: string
  ): string {
    const hp = body?.hashedPassword;
    if (!hp || typeof hp !== "string" || !hp.trim()) {
      throw this.fail(
        400,
        "invalid_request",
        "hashedPassword is required",
        requestId
      ) as unknown as never;
    }
    return hp.trim();
  }

  /**
   * Convenience extractor for common “auth provision” payload:
   * - Validates presence of user & hashedPassword (opaque).
   * - Returns normalized { user, hashedPassword }.
   */
  protected extractProvisionPayload<TUser = unknown>(
    body: ProvisionPayload<TUser>,
    requestId: string
  ): { user: TUser; hashedPassword: string } {
    const user = body?.user as TUser | undefined;
    if (user === undefined || user === null) {
      throw this.fail(
        400,
        "invalid_request",
        "user payload is required",
        requestId
      ) as unknown as never;
    }
    const hashedPassword = this.requireHashedPassword(body, requestId);
    return { user, hashedPassword };
  }

  /**
   * Opaque hash compare (placeholder).
   * TODO(SEC): replace with constant-time compare once we store real hashes.
   */
  protected compareOpaqueHash(a: string, b: string): boolean {
    return typeof a === "string" && typeof b === "string" && a === b;
  }
}
