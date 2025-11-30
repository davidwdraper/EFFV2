// backend/services/shared/src/dto/templates/auth/auth.dto.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; DTO is canonical shape)
 *   - ADR-0050 (Wire Bag Envelope — DTOs live only inside bags)
 *   - ADR-0053 (Instantiation discipline via DtoBase secret)
 *
 * Purpose:
 * - Auth MOS DTO carrying user *identity basics* for auth-related operations.
 * - This DTO is **not** tied to a DB collection; auth is a MOS, not a CRUD entity
 *   service. No collection name, no index hints, no persistence assumptions.
 *
 * Fields (v1):
 * - givenName  (required)
 * - lastName   (required)
 * - email      (required; normalized to lowercase/trimmed)
 * - phone      (optional)
 * - homeLat    (optional; number, home location latitude)
 * - homeLng    (optional; number, home location longitude)
 *
 * Notes:
 * - This DTO is used for inbound/outbound auth flows (e.g., create, signon,
 *   change-password) to carry user-facing attributes. Password / credential
 *   DTOs will be defined separately so that secrets never mix with general
 *   profile fields.
 */

import { DtoBase } from "./DtoBase";
import type { IDto } from "./IDto";

// Wire-friendly shape for this DTO
export type AuthJson = {
  // Optional canonical id slot — not required by MOS flows, but kept for
  // consistency with the wire envelope convention.
  id?: string;
  type?: "auth"; // dtoType key on the wire

  givenName: string;
  lastName: string;
  email: string;
  phone?: string;
  homeLat?: number;
  homeLng?: number;

  // Meta fields stamped via DtoBase (when used)
  createdAt?: string;
  updatedAt?: string;
  updatedByUserId?: string;
};

export class AuthDto extends DtoBase implements IDto {
  // ─────────────── Instance: Domain Fields ───────────────

  public givenName = "";
  public lastName = "";
  public email = "";
  public phone?: string;
  public homeLat?: number;
  public homeLng?: number;

  /**
   * Accepts either the DtoBase secret (Registry path) OR meta (fromBody path).
   * This matches DtoBase’s `(secretOrArgs?: symbol | _DtoMeta)` contract.
   */
  public constructor(
    secretOrMeta?:
      | symbol
      | { createdAt?: string; updatedAt?: string; updatedByUserId?: string }
  ) {
    super(secretOrMeta);
  }

  // ─────────────── Static: Hydration ───────────────

  /** Wire hydration (plug Zod here when opts?.validate is true). */
  public static fromBody(
    json: unknown,
    opts?: { validate?: boolean }
  ): AuthDto {
    const dto = new AuthDto(DtoBase.getSecret());
    const j = (json ?? {}) as Partial<AuthJson>;

    // Required-ish fields: we accept strings and normalize; formal validation
    // is handled by the contract layer (Zod) once wired.
    if (typeof j.givenName === "string") {
      dto.givenName = j.givenName.trim();
    }

    if (typeof j.lastName === "string") {
      dto.lastName = j.lastName.trim();
    }

    if (typeof j.email === "string") {
      dto.email = j.email.trim().toLowerCase();
    }

    if (typeof j.phone === "string") {
      const trimmed = j.phone.trim();
      dto.phone = trimmed.length ? trimmed : undefined;
    }

    // homeLat / homeLng: accept number or numeric string; ignore NaN.
    if (j.homeLat !== undefined) {
      const n = typeof j.homeLat === "string" ? Number(j.homeLat) : j.homeLat;
      if (Number.isFinite(n as number)) {
        dto.homeLat = n as number;
      }
    }

    if (j.homeLng !== undefined) {
      const n = typeof j.homeLng === "string" ? Number(j.homeLng) : j.homeLng;
      if (Number.isFinite(n as number)) {
        dto.homeLng = n as number;
      }
    }

    // Meta: if present on wire, capture it for _finalizeToJson().
    dto.setMeta({
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByUserId: j.updatedByUserId,
    });

    // opts?.validate hook: once the Zod contract is defined for AuthJson,
    // this is where strict validation will be invoked.

    return dto;
  }

  // ─────────────── Instance: Wire Shape ───────────────

  /** Canonical outbound wire shape; meta is stamped by _finalizeToJson(). */
  public toBody(): AuthJson {
    const body: AuthJson = {
      // id is optional for MOS; we surface it if present but do not require it.
      id: this._id,
      type: "auth",

      givenName: this.givenName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      homeLat: this.homeLat,
      homeLng: this.homeLng,
    };

    return this._finalizeToJson(body);
  }

  /** Optional patch helper used by update/merge-style pipelines. */
  public patchFrom(json: Partial<AuthJson>): this {
    if (json.givenName !== undefined && typeof json.givenName === "string") {
      this.givenName = json.givenName.trim();
    }

    if (json.lastName !== undefined && typeof json.lastName === "string") {
      this.lastName = json.lastName.trim();
    }

    if (json.email !== undefined && typeof json.email === "string") {
      this.email = json.email.trim().toLowerCase();
    }

    if (json.phone !== undefined) {
      if (typeof json.phone === "string") {
        const trimmed = json.phone.trim();
        this.phone = trimmed.length ? trimmed : undefined;
      } else {
        this.phone = undefined;
      }
    }

    if (json.homeLat !== undefined) {
      const n =
        typeof json.homeLat === "string" ? Number(json.homeLat) : json.homeLat;
      if (Number.isFinite(n as number)) {
        this.homeLat = n as number;
      }
    }

    if (json.homeLng !== undefined) {
      const n =
        typeof json.homeLng === "string" ? Number(json.homeLng) : json.homeLng;
      if (Number.isFinite(n as number)) {
        this.homeLng = n as number;
      }
    }

    return this;
  }

  // ─────────────── IDto contract ───────────────

  /** Canonical DTO type key (registry key). */
  public getType(): string {
    return "auth";
  }

  /**
   * Canonical DTO id.
   * MOS flows do not *require* an id, but the base class still tracks one
   * so we can correlate instances if needed (e.g., audit, logs).
   */
  public getId(): string {
    if (!this._id) {
      throw new Error(
        "AuthDto.getId() called but this DTO has no id assigned. " +
          "As a MOS DTO, id is optional. If you need correlation, " +
          "ensure the controller or pipeline assigns an id explicitly."
      );
    }
    return this._id;
  }
}
