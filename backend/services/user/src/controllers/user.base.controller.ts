// backend/services/user/src/controllers/user.base.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/00xx-user-service-skeleton.md (TBD)
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *
 * Purpose:
 * - Per-service base controller for the User service.
 * - Extends shared ControllerBase and standardizes env-driven service name.
 * - Centralizes S2S envelope helpers for hashed-password flows (create/signon/changePassword).
 *
 * Notes:
 * - Fail-fast on missing SVC_NAME to avoid silent mislabeling in logs/headers.
 * - Hash handling is MOCK for now (prefix check + equality). Replace with real KDF later.
 * - Controllers should delegate envelope extraction and hash checks to this base.
 */

import { ControllerBase } from "@nv/shared/base/ControllerBase";

/** Canonical S2S envelope shape expected from Auth → User. */
export type AuthS2SEnvelope<TUser = unknown> = {
  user?: TUser; // expected to conform to UserContract JSON (validated upstream or here later)
  hashedPassword?: string; // must be a hash (Auth creates; User stores/compares)
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

  // ===================== Hashed Password Helpers (MOCK for now) =====================

  /**
   * Ensure the envelope contains a non-empty hashedPassword string.
   * Returns the trimmed hash or throws a HandlerResult via this.fail(400).
   */
  protected requireHashedPassword(
    env: AuthS2SEnvelope,
    requestId: string
  ): string {
    const hp = env?.hashedPassword;
    if (!hp || typeof hp !== "string" || !hp.trim()) {
      // Throwing the HandlerResult is intentional; upstream controller can catch or let SvcReceiver handle.
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
   * Mock hash format guard. Today we accept "mockhash:<...>" only to prevent
   * accidental acceptance of plaintext. Replace when real KDF lands.
   */
  protected isMockHash(h: string): boolean {
    return typeof h === "string" && h.startsWith("mockhash:");
  }

  /**
   * Mock compare: require both to be mock hashes and equal byte-for-byte.
   * Replace with constant-time compare when real hashes are used.
   */
  protected compareHashed(candidateHash: string, storedHash: string): boolean {
    return (
      this.isMockHash(candidateHash) &&
      this.isMockHash(storedHash) &&
      candidateHash === storedHash
    );
  }

  /**
   * Convenience extractor for common “auth provision” envelope:
   * - Validates presence of user & hashedPassword (mock format).
   * - Returns normalized { user, hashedPassword }.
   * Controllers can call this right after handler context unwrap.
   */
  protected extractProvisionEnvelope<TUser = unknown>(
    body: Partial<AuthS2SEnvelope<TUser>>,
    requestId: string
  ): { user: TUser; hashedPassword: string } {
    const env = (body || {}) as AuthS2SEnvelope<TUser>;
    const user = env.user as TUser | undefined;
    if (user === undefined || user === null) {
      throw this.fail(
        400,
        "invalid_request",
        "user payload is required",
        requestId
      ) as unknown as never;
    }
    const hashedPassword = this.requireHashedPassword(env, requestId);
    if (!this.isMockHash(hashedPassword)) {
      throw this.fail(
        400,
        "invalid_request",
        "hashedPassword must be a mock hash",
        requestId
      ) as unknown as never;
    }
    return { user, hashedPassword };
  }
}
