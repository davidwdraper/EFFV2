// backend/services/shared/src/dto/wire/BagMeta.ts
/**
 * Docs:
 * - ADRs:
 *   - ADR-0050 (Wire Bag Envelope & Cursor Semantics)
 *
 * Purpose:
 * - Meta information shipped alongside items[] in wire responses/requests.
 */

export type BagMeta = {
  cursor: string | null;
  limit: number;
  total?: number | null;
  requestId: string;
  elapsedMs: number;
};
