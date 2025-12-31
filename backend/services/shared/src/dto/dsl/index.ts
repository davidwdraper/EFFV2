// backend/services/shared/src/dto/dsl/index.ts
/**
 * Docs:
 * - SOP: Keep shared exports tight; avoid drift and schema sprawl.
 * - ADRs:
 *   - ADR-0089
 *   - ADR-0090
 *
 * Purpose:
 * - Public export surface for the DTO Field DSL helpers.
 */

export { field } from "./field";
export { unwrapMetaEnvelope } from "./envelope";
export type {
  FieldDescriptor,
  FieldKind,
  FieldsShape,
  FieldUiMeta,
} from "./types";
