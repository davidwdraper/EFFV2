// backend/services/shared/src/contracts/user.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0005 (Gateway→Auth→User — signup plumbing, mocked hash)
 *
 * Purpose:
 * - Canonical User contract (lean for now): email only.
 * - Password is NEVER part of this contract; it travels separately in the envelope.
 *
 * Notes:
 * - Extends BaseContract to centralize validation/normalization as the system grows.
 */

import { BaseContract } from "./base.contract";

export interface IUserContract {
  /** User’s primary email (required). */
  email: string;
}

export class UserContract
  extends BaseContract<IUserContract>
  implements IUserContract
{
  public readonly email: string;

  private constructor(email: string) {
    super();
    this.email = email;
  }

  /** Create from unknown, throwing on invalid shape. */
  public static from(input: unknown): UserContract {
    const obj = this.ensurePlainObject(input, "user");
    const email = this.takeString(obj, "email", {
      required: true,
      trim: true,
    })!;
    this.requirePattern(email, this.EMAIL_RE, "email", "invalid email");
    return new UserContract(email);
  }

  /** Narrowing type guard. */
  public static is(input: unknown): input is IUserContract {
    try {
      const obj = this.ensurePlainObject(input, "user");
      const email = this.takeString(obj, "email", {
        required: true,
        trim: true,
      });
      if (!email) return false;
      this.requirePattern(email, this.EMAIL_RE, "email", "invalid email");
      return true;
    } catch {
      return false;
    }
  }

  /** JSON-friendly shape. */
  public toJSON(): IUserContract {
    return { email: this.email };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** Minimal sanity regex; real validation can be upgraded later without API breakage. */
  private static readonly EMAIL_RE = /^\S+@\S+\.\S+$/;
}
