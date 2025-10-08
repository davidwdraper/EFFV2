// backend/services/shared/src/contracts/audit/audit.base.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Thin shared base for all audit contracts.
 * - Pure, static helpers only (no I/O, no logging, no DB/WAL).
 */

import { BaseContract } from "../base.contract";

export abstract class AuditContractBase<
  TJson extends object
> extends BaseContract<TJson> {
  /** Defaults & bounds (shared) */
  public static readonly DEFAULT_BILLABLE_UNITS = 1 as const;
  public static readonly HTTP_MIN = 100 as const;
  public static readonly HTTP_MAX = 599 as const;

  /** Numbers & ranges */
  protected static toNonNegInt(v: unknown, field: string): number {
    if (!Number.isInteger(v) || (v as number) < 0) {
      throw new Error(`${field}: expected nonnegative integer`);
    }
    return v as number;
  }
  protected static toIntInRange(
    v: unknown,
    min: number,
    max: number,
    field: string
  ): number {
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
      throw new Error(`${field}: expected integer in ${min}..${max}`);
    }
    return v as number;
  }

  /** Time helpers */
  protected static isIsoLike(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T/.test(s);
  }
  protected static toIso(msEpoch: number): string {
    if (!Number.isInteger(msEpoch) || msEpoch < 0) {
      throw new Error(`ts: expected nonnegative integer (ms epoch)`);
    }
    return new Date(msEpoch).toISOString();
  }

  /** ID helpers */
  protected static finalizeEventId(requestId: string, endTs: number): string {
    return `evt-${requestId}-${String(endTs)}`;
  }

  /** Normalizers */
  protected static normalizeMethod(m: string): string {
    return m.trim().toUpperCase();
  }
  protected static normalizePath(p: string): string {
    // keep simple & predictable; no trailing slash magic
    return p.trim();
  }
  protected static normalizeSlug(s: string): string {
    return s.trim().toLowerCase();
  }

  /** Meta redaction hook (no-op for now) */
  protected static redactMeta(
    meta?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    return meta;
  }
}
