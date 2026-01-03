// backend/services/shared/src/testing/TestScenarioFinalizer.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose (single concern):
 * - Provide the shared, deterministic “finally-block brain” for test scenarios.
 * - Turns the live scenario ctx (rails state) into a minimal RailsSnapshot and
 *   calls TestScenarioStatus.finalize() exactly once (idempotent).
 *
 * Non-goals:
 * - NOT an ALS / adaptive logging system.
 * - NOT a logger.
 * - NOT a place to invent new flags or infer “intent”.
 *
 * Invariants:
 * - Finalizer must be safe to call from BOTH inner + outer finally blocks.
 * - Finalizer never throws (it must not mask the real error).
 */

import type { RailsSnapshot, TestScenarioOutcome } from "./TestScenarioStatus";
import { TestScenarioStatus } from "./TestScenarioStatus";

/**
 * Minimal “ctx-like” contract to avoid coupling tests to HandlerContext type.
 * Any object with get(key) works (HandlerContext does).
 */
export type CtxLike = {
  get: (key: string) => unknown;
};

export class TestScenarioFinalizer {
  /**
   * Finalize a scenario deterministically.
   *
   * Call-site rules (ADR-0094):
   * - Inner finally calls this after inner try/catch completes.
   * - Outer finally calls this after outer try/catch completes.
   * - Either way is fine because TestScenarioStatus.finalize() is idempotent.
   */
  public static finalize(args: {
    status: TestScenarioStatus;
    ctx?: CtxLike;
    failureTagsObserved?: string[];
  }): TestScenarioOutcome {
    const rails = args.ctx ? this.snapshotRails(args.ctx) : undefined;

    // Never throw from finalizer — return a “hard red” outcome instead.
    try {
      return args.status.finalize({
        rails,
        failureTagsObserved: args.failureTagsObserved ?? [],
      });
    } catch (e) {
      // This should be impossible if status.finalize() stays pure.
      // Treat as infrastructure failure (outcome 5) without relying on ALS/log hacks.
      args.status.recordOuterCatch(e);
      return args.status.finalize({
        rails,
        failureTagsObserved: args.failureTagsObserved ?? [],
      });
    }
  }

  /**
   * Build the smallest possible rails snapshot needed for ADR-0094 classification.
   * We intentionally DO NOT “understand” the full ctx schema — we only sample
   * a few well-known rails keys used across the runner/test ecosystem.
   */
  public static snapshotRails(ctx: CtxLike): RailsSnapshot {
    const handlerStatus = this.tryString(ctx, "handlerStatus");

    // Standardize on a single httpStatus number if present.
    // Order matters: prefer response.status if the controller populated it.
    const httpStatus =
      this.tryNumber(ctx, "response.status") ??
      this.tryNumber(ctx, "status") ??
      this.tryNumber(ctx, "httpStatus");

    const snap: RailsSnapshot = {};
    if (handlerStatus !== undefined) snap.handlerStatus = handlerStatus;
    if (httpStatus !== undefined) snap.httpStatus = httpStatus;

    return snap;
  }

  private static tryString(ctx: CtxLike, key: string): string | undefined {
    const v = ctx.get(key);
    if (typeof v === "string") return v;
    return undefined;
  }

  private static tryNumber(ctx: CtxLike, key: string): number | undefined {
    const v = ctx.get(key);
    if (typeof v === "number" && Number.isFinite(v)) return v;

    // Some rails store numeric values as strings. Accept only clean integers.
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }

    return undefined;
  }
}
