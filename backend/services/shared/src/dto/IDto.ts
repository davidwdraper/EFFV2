// backend/services/shared/src/dto/IDto.ts
/**
 * Docs:
 * - SOP: DTO-first; single construction path via registry
 * - ADRs:
 *   - ADR-0049 (DTO Registry; canonical string id; wire vs db modes)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4; immutable; WARN on overwrite attempt)
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *   - ADR-0103 (DTO naming convention: keys, filenames, classnames)
 *
 * Purpose:
 * - Minimal interface every DTO must expose to participate in bags, adapters, and logging.
 *
 * Notes:
 * - clone(newId?) is defensive (rare) — not a hot path.
 * - getType() is removed; registry addressing is via dtoKey.
 */

export interface IDto {
  /** Canonical, immutable ID (string). Must be UUIDv4 if set. */
  getId(): string;

  /** True if id is present (one-shot semantics). */
  hasId(): boolean;

  /**
   * Canonical registry key for this DTO (e.g., "db.env-service.dto", "xxx.dto").
   * - Replaces getType().
   * - Used for cloning, logging, and registry resolution.
   */
  getDtoKey(): string;

  /**
   * Serialize for wire/persistence; must be JSON-ready (POJO).
   * Transport is responsible for JSON.stringify().
   */
  toBody(): Record<string, unknown>;

  /**
   * Defensive copy that returns a new instance with identical data but a new ID.
   * Implementations should bypass validation (source is already valid)
   * and reset meta timestamps internally.
   */
  clone(newId?: string): this;
}
