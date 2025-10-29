// backend/services/shared/src/dto/DtoBagView.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
 *
 * Purpose:
 * - Read-only lens over a DtoBag.
 * - Provides iteration, filtered subviews, and JSON serialization helpers.
 * - Exposes .bag() and .indices() so callers (e.g., DtoBag.ts) can introspect safely.
 *
 * Notes:
 * - DtoBag holds DTO instances; DtoBagView presents them.
 * - Use DtoBagView at network edges to call DTO.toJson() safely.
 * - Static factory fromBag() builds the full index range.
 */

import { DtoBag } from "./DtoBag";

export class DtoBagView<T> implements Iterable<T> {
  private readonly _bag: DtoBag<T>;
  private readonly _indices: readonly number[];

  /**
   * Construct a view directly.
   * @param bag Immutable DtoBag
   * @param indices Readonly index list (subset or full range)
   */
  constructor(bag: DtoBag<T>, indices: readonly number[]) {
    this._bag = bag;
    this._indices = indices;
  }

  /**
   * Full-range view over a bag (0..n-1).
   */
  public static fromBag<T>(bag: DtoBag<T>): DtoBagView<T> {
    // Prefer a dedicated size() on DtoBag; fall back to common shapes.
    const length =
      typeof (bag as any).size === "function"
        ? (bag as any).size()
        : Array.isArray((bag as any)._items)
        ? (bag as any)._items.length
        : (() => {
            let n = 0;
            for (const _ of bag as any) n++;
            return n;
          })();

    const indices: number[] = Array.from({ length }, (_, i) => i);
    return new DtoBagView<T>(bag, indices);
  }

  /** Back-compat: expose underlying bag as a method (called by DtoBag.ts). */
  public bag(): DtoBag<T> {
    return this._bag;
  }

  /** Back-compat: expose index list as a method (called by DtoBag.ts). */
  public indices(): readonly number[] {
    return this._indices;
  }

  /** Iterator over DTOs in this view. */
  public [Symbol.iterator](): Iterator<T> {
    // Expect DtoBag to provide at(i); fall back to internal shape if needed.
    const arr = this._indices.map((i) => {
      const at = (this._bag as any).at;
      if (typeof at === "function") return at.call(this._bag, i);
      // fallback: if _items exists
      const items = (this._bag as any)._items;
      return Array.isArray(items) ? items[i] : undefined;
    });
    return arr[Symbol.iterator]();
  }

  /** Count of DTOs in the view. */
  public size(): number {
    return this._indices.length;
  }

  /** Filtered subview (indices-only). */
  public filter(pred: (dto: T) => boolean): DtoBagView<T> {
    const newIdx: number[] = [];
    for (const i of this._indices) {
      const dto = (this._bag as any).at
        ? (this._bag as any).at(i)
        : (this._bag as any)._items?.[i];
      if (pred(dto)) newIdx.push(i);
    }
    return new DtoBagView<T>(this._bag, newIdx);
  }

  /** Serialize DTOs to pure JSON (calls DTO.toJson() if present). */
  public toJsonArray(): unknown[] {
    const out: unknown[] = [];
    for (const i of this._indices) {
      const dto = (this._bag as any).at
        ? (this._bag as any).at(i)
        : (this._bag as any)._items?.[i];
      if (dto && typeof (dto as any).toJson === "function") {
        out.push((dto as any).toJson());
      } else {
        out.push(dto);
      }
    }
    return out;
  }
}
