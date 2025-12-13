// backend/services/shared/src/http/handlers/testing/HandlerTestBase.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Shared base class for handler-level tests.
 * - Handles:
 *   • standard run() wrapper with pass/fail result,
 *   • basic assertion helpers (this.assert),
 *   • BagCount checks for DtoBag instances.
 *
 * Invariants:
 * - Tests throw on assertion failure; HandlerTestBase converts that into a
 *   structured HandlerTestResult.
 * - Tests live side-by-side with the handler under test:
 *   code.foo.bar.ts + code.foo.bar.test.ts.
 *
 * Notes:
 * - Your pasted path had `htpp/...` — that typo will break imports.
 *   This file must live under `http/handlers/testing` to match your imports.
 */

import type { ILogger } from "@nv/shared/logger/Logger";
import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DtoBase } from "@nv/shared/dto/DtoBase";

export type HandlerTestOutcome = "passed" | "failed";

export interface HandlerTestResult {
  testId: string;
  name: string;
  outcome: HandlerTestOutcome;
  assertionCount: number;
  failedAssertions: string[];
  errorMessage?: string;
  durationMs: number;
}

/**
 * Base class for all handler tests.
 * - Subclasses implement testId(), testName(), and execute().
 * - run() is the single entrypoint used by the test-runner.
 */
export abstract class HandlerTestBase {
  protected readonly log?: ILogger;

  private assertionCount = 0;

  constructor(params?: { log?: ILogger }) {
    this.log = params?.log;
  }

  /** Stable test identifier (used in logs and summaries). */
  public abstract testId(): string;

  /** Human-friendly name for ops and developers. */
  public abstract testName(): string;

  /**
   * Main entrypoint called by the test-runner.
   * - Wraps execute() in a try/catch and returns a structured result.
   */
  public async run(): Promise<HandlerTestResult> {
    const startedAt = Date.now();

    const failedAssertions: string[] = [];
    let errorMessage: string | undefined;
    let outcome: HandlerTestOutcome = "passed";

    try {
      await this.execute();
    } catch (err) {
      outcome = "failed";
      errorMessage = this.toErrorMessage(err);
      failedAssertions.push(errorMessage);

      if (this.log) {
        this.log.error(
          {
            testId: this.testId(),
            name: this.testName(),
            error: errorMessage,
          },
          "handler-test: failure"
        );
      }
    }

    const finishedAt = Date.now();

    return {
      testId: this.testId(),
      name: this.testName(),
      outcome,
      assertionCount: this.assertionCount,
      failedAssertions,
      errorMessage,
      durationMs: Math.max(0, finishedAt - startedAt),
    };
  }

  /**
   * Subclasses implement the actual test logic here.
   * - Throw on failure; do not swallow errors.
   */
  protected abstract execute(): Promise<void>;

  // ------------------------------
  // Assertion Helpers
  // ------------------------------

  /**
   * Primary assertion helper used by tests.
   * - Counts exactly ONE assertion per call (even when it fails).
   * - Throws on failure so the test stops at first failed assertion (KISS).
   */
  protected assert(condition: unknown, message: string): void {
    this.recordAssertion();
    if (!condition) {
      throw new Error(message);
    }
  }

  /**
   * Explicit fail helper for rare cases where an assertion does not map to a boolean check.
   * - Counts as one assertion.
   */
  protected fail(message: string): never {
    this.recordAssertion();
    throw new Error(message);
  }

  // ------------------------------
  // BagCount helpers
  // ------------------------------

  /**
   * BagCount(:dtoBag, "eq0" | "eq1" | "ge0" | "ge1")
   * - Uses items() iterator; no assumptions about Bag internals.
   */
  protected assertBagCount<TDto extends DtoBase>(
    bag: DtoBag<TDto>,
    comparator: "eq0" | "eq1" | "ge0" | "ge1",
    label?: string
  ): void {
    const ctxLabel = label || this.testId();
    let count = 0;

    for (const _ of bag.items()) {
      count += 1;
    }

    let ok = false;
    switch (comparator) {
      case "eq0":
        ok = count === 0;
        break;
      case "eq1":
        ok = count === 1;
        break;
      case "ge0":
        ok = count >= 0;
        break;
      case "ge1":
        ok = count >= 1;
        break;
      default:
        this.fail(
          `BagCount(${ctxLabel}): unsupported comparator "${comparator}".`
        );
    }

    this.assert(
      ok,
      `BagCount(${ctxLabel}): expected ${comparator}, actual=${count}.`
    );
  }

  // ------------------------------
  // Internal helpers
  // ------------------------------

  private recordAssertion(): void {
    this.assertionCount += 1;
  }

  private toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return String(err ?? "unknown error");
  }
}
