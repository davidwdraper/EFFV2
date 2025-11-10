// backend/services/shared/src/dto/DtoBag.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *
 * Purpose:
 * - Immutable, generic in-memory container for DTOs.
 * - Factory for read-only DtoBagView lenses (filter/sort/slice).
 *
 * Invariants:
 * - Never mutates; holds the master ordered array of DTOs.
 * - Does not expose raw arrays; callers operate on DtoBagView instances.
 * - All refining operations live here and RETURN NEW VIEWS.
 *
 * Notes:
 * - No logging here. Handlers/controllers log as needed.
 * - No DB logic here. Batching/pagination at the DB is owned by DbReader.
 */

import { DtoBagView } from "./DtoBagView";

export type PathOrGetter<T> = string | ((dto: T) => unknown);

export type OrderDir = "asc" | "desc";

export type OrderClause<T> = {
  by: PathOrGetter<T>;
  dir?: OrderDir; // default asc
  nullsLast?: boolean;
  compare?: (a: unknown, b: unknown) => number;
};

export type FilterPredicate<T> = (dto: T) => boolean;

export type DeclarativePredicate<T> =
  | {
      prop: PathOrGetter<T>;
      in?: Iterable<unknown>;
      notIn?: Iterable<unknown>;
      eq?: unknown;
      ne?: unknown;
      gte?: unknown;
      lte?: unknown;
      gt?: unknown;
      lt?: unknown;
      ci?: boolean;
      normalize?: (s: string) => string;
    }
  | FilterPredicate<T>;

export type FilterPlan<T> = {
  and?: DeclarativePredicate<T>[];
  or?: DeclarativePredicate<T>[];
  not?: DeclarativePredicate<T>[];
};

type IncludeOptions = { ci?: boolean; normalize?: (s: string) => string };

function isFn<T>(p: PathOrGetter<T>): p is (dto: T) => unknown {
  return typeof p === "function";
}

function getValue<T>(dto: T, pathOrGetter: PathOrGetter<T>): unknown {
  if (isFn(pathOrGetter)) return pathOrGetter(dto);
  const path = String(pathOrGetter);
  if (!path.includes(".")) return (dto as any)?.[path];
  let cur: any = dto as any;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function normIfString(v: unknown, opts?: IncludeOptions): unknown {
  if (typeof v === "string") {
    const lowered = opts?.ci ? v.toLocaleLowerCase() : v;
    return opts?.normalize ? opts.normalize(lowered) : lowered;
  }
  return v;
}

function toSet(values: Iterable<unknown>, opts?: IncludeOptions): Set<unknown> {
  const s = new Set<unknown>();
  for (const v of values) s.add(normIfString(v, opts));
  return s;
}

function cmpBasic(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null && b != null) return -1;
  if (a != null && b == null) return 1;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return a < b ? -1 : 1;
}

function clauseCompare<T>(a: T, b: T, c: OrderClause<T>): number {
  const av = getValue(a, c.by);
  const bv = getValue(b, c.by);
  const dir = c.dir === "desc" ? -1 : 1;

  if (c.compare) return dir * c.compare(av, bv);

  const base = cmpBasic(av, bv);

  if (c.nullsLast) {
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull !== bNull) {
      return (aNull ? 1 : -1) * dir;
    }
  }

  return dir * base;
}

export class DtoBag<T> {
  private readonly _items: ReadonlyArray<T>;

  constructor(items: ReadonlyArray<T>) {
    this._items = Array.isArray(items) ? items.slice() : Array.from(items);
  }

  public count(): number {
    return this._items.length;
  }

  public size(): number {
    return this._items.length;
  }
  public get(i: number): T {
    return this._items[i];
  }

  /**
   * Iterate DTOs in stable order without exposing the raw array.
   * Compatible with DbWriter.writeMany() expecting bag.items().
   */
  public *items(): IterableIterator<T> {
    for (let i = 0; i < this._items.length; i++) {
      yield this._items[i];
    }
  }

  /** Allow `for...of (const dto of bag)` syntax without leaking arrays. */
  public [Symbol.iterator](): IterableIterator<T> {
    return this.items();
  }

  /**
   * Ensure this bag is a singleton.
   * Throws if size !== 1, so callers that expect a single DTO can rely on it.
   */
  // inside DtoBag<T>
  public ensureSingleton(throwOnError = true): boolean {
    const count = this._items.length;

    if (count === 1) return true;

    const msg =
      count === 0
        ? "DtoBag.ensureSingleton(): expected 1 item but bag is empty."
        : `DtoBag.ensureSingleton(): expected 1 item but found ${count}.`;

    if (throwOnError) throw new Error(msg);

    // return false instead of throwing
    return false;
  }

  /**
   * Convenience: return the single DTO in this bag.
   * Internally calls ensureSingleton() to enforce invariants.
   */
  public getSingleton(): T {
    this.ensureSingleton();
    return this._items[0];
  }

  public viewAll(): DtoBagView<T> {
    const n = this._items.length;
    const indices = new Array<number>(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    return new DtoBagView<T>(this, indices);
  }

  public viewFilter(
    predicate: FilterPredicate<T>,
    base?: DtoBagView<T>
  ): DtoBagView<T> {
    const source = base ?? this.viewAll();
    const next: number[] = [];
    const bag = source.bag();
    const idx = source.indices();
    for (let i = 0; i < idx.length; i++) {
      const bi = idx[i];
      const dto = bag.get(bi);
      if (predicate(dto)) next.push(bi);
    }
    return new DtoBagView<T>(this, next);
  }

  public viewInclude(
    prop: PathOrGetter<T>,
    allowed: Iterable<unknown>,
    opts?: IncludeOptions,
    base?: DtoBagView<T>
  ): DtoBagView<T> {
    const allowSet = toSet(allowed, opts);
    return this.viewFilter((dto) => {
      const v = normIfString(getValue(dto, prop), opts);
      return allowSet.has(v);
    }, base);
  }

  public viewExclude(
    prop: PathOrGetter<T>,
    blocked: Iterable<unknown>,
    opts?: IncludeOptions,
    base?: DtoBagView<T>
  ): DtoBagView<T> {
    const blockSet = toSet(blocked, opts);
    return this.viewFilter((dto) => {
      const v = normIfString(getValue(dto, prop), opts);
      return !blockSet.has(v);
    }, base);
  }

  public viewWhere(plan: FilterPlan<T>, base?: DtoBagView<T>): DtoBagView<T> {
    const pred = (dto: T): boolean => {
      const passesGroup = (
        ps?: DeclarativePredicate<T>[],
        mode: "and" | "or" = "and"
      ) => {
        if (!ps || ps.length === 0) return mode === "and";
        let any = false;
        for (const p of ps) {
          const ok =
            typeof p === "function" ? p(dto) : this.evalDeclarative(dto, p);
          if (mode === "or" && ok) return true;
          if (mode === "and" && !ok) return false;
          any = true;
        }
        return mode === "and" ? true : any;
      };
      const a = passesGroup(plan.and, "and");
      const o = passesGroup(plan.or, "or");
      const n = plan.not ? !passesGroup(plan.not, "and") : true;
      const orOk = plan.or && plan.or.length > 0 ? o : true;
      return a && n && orOk;
    };
    return this.viewFilter(pred, base);
  }

  private evalDeclarative(
    dto: T,
    p: Exclude<DeclarativePredicate<T>, Function>
  ): boolean {
    const opts: IncludeOptions = { ci: p.ci, normalize: p.normalize };
    const v = normIfString(getValue(dto, p.prop), opts);

    if ("eq" in p && p.eq !== undefined) {
      return normIfString(p.eq, opts) === v;
    }
    if ("ne" in p && p.ne !== undefined) {
      return normIfString(p.ne, opts) !== v;
    }
    if (p.in) {
      const s = toSet(p.in, opts);
      return s.has(v);
    }
    if (p.notIn) {
      const s = toSet(p.notIn, opts);
      return !s.has(v);
    }

    // --- Range-like comparisons (explicit casts silence TS18046 while keeping behavior) ---
    const vv: any = v;
    if (p.gte !== undefined) {
      const rhs: any = normIfString(p.gte, opts);
      if (!(vv >= rhs)) return false;
    }
    if (p.lte !== undefined) {
      const rhs: any = normIfString(p.lte, opts);
      if (!(vv <= rhs)) return false;
    }
    if (p.gt !== undefined) {
      const rhs: any = normIfString(p.gt, opts);
      if (!(vv > rhs)) return false;
    }
    if (p.lt !== undefined) {
      const rhs: any = normIfString(p.lt, opts);
      if (!(vv < rhs)) return false;
    }

    // If no operator matched, treat as true (predicate vacuously satisfied).
    return true;
  }

  public viewOrderBy(
    order: OrderClause<T> | OrderClause<T>[],
    base?: DtoBagView<T>
  ): DtoBagView<T> {
    const source = base ?? this.viewAll();
    const idx = source.indices().slice();
    const clauses = Array.isArray(order) ? order : [order];

    idx.sort((i, j) => {
      const a = this.get(i);
      const b = this.get(j);
      for (const c of clauses) {
        const r = clauseCompare(a, b, c);
        if (r !== 0) return r;
      }
      return i - j;
    });

    return new DtoBagView<T>(this, idx);
  }

  public viewPaginate(
    offset: number,
    limit: number,
    base?: DtoBagView<T>
  ): DtoBagView<T> {
    const source = base ?? this.viewAll();
    const start = Math.max(0, offset | 0);
    const end = Math.max(
      start,
      Math.min(source.indices().length, start + Math.max(0, limit | 0))
    );
    const slice = source.indices().slice(start, end);
    return new DtoBagView<T>(this, slice);
  }

  public viewDistinct(
    prop: PathOrGetter<T>,
    opts?: IncludeOptions,
    base?: DtoBagView<T>
  ): Set<unknown> {
    const source = base ?? this.viewAll();
    const out = new Set<unknown>();
    for (const i of source.indices()) {
      const v = normIfString(getValue(this.get(i), prop), opts);
      out.add(v);
    }
    return out;
  }

  public viewGroupBy(
    prop: PathOrGetter<T>,
    opts?: IncludeOptions,
    base?: DtoBagView<T>
  ): Map<unknown, DtoBagView<T>> {
    const source = base ?? this.viewAll();
    const buckets = new Map<unknown, number[]>();
    for (const i of source.indices()) {
      const v = normIfString(getValue(this.get(i), prop), opts);
      const arr = buckets.get(v) ?? [];
      arr.push(i);
      buckets.set(v, arr);
    }
    const out = new Map<unknown, DtoBagView<T>>();
    for (const [k, arr] of buckets.entries())
      out.set(k, new DtoBagView<T>(this, arr));
    return out;
  }
}
