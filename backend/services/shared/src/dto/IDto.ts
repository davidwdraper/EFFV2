// backend/services/shared/src/dto/IDto.ts
/**
 * Docs:
 * - SOP: DTO-first; single construction path via registry
 * - ADRs:
 *   - ADR-0049 (DTO Registry; canonical string id; wire vs db modes)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *
 * Purpose:
 * - Minimal interface every DTO must expose to participate in bags, adapters, and logging.
 *
 * Notes:
 * - clone(newId?) is defensive (e.g., rare key collisions) — not a hot path.
 */

export interface IDto {
  /** Canonical, immutable ID (string). Must be UUIDv4 if set. */
  getId(): string;

  /** True if id is present (one-shot semantics). */
  hasId(): boolean;

  /** Wire discriminator used by the registry/bag (e.g., "xxx"). */
  getType(): string;

  /** Serialize for wire/persistence; MUST include at least { id, type }. */
  toJson(): unknown;

  /**
   * Defensive copy that returns a new instance with identical data but a new ID.
   * Implementations should bypass validation (source is already valid)
   * and reset meta timestamps internally.
   */
  clone(newId?: string): this;
}
