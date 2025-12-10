// backend/services/shared/src/testing/handler/HandlerTestsBase.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak; tests exercise rails, not ad-hoc paths.
 * - ADRs:
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Provide a common base for handler-level test suites.
 * - Define a standard, non-brittle shape for handler tests so the test-runner
 *   can discover and execute them reliably.
 * - Centralize tiny reusable helpers (regex matchers, UUID validators, bag
 *   cardinality checks, etc.) so individual tests stay focused on intent.
 *
 * Invariants:
 * - Tests are code, not raw JSON blobs.
 * - Each test suite maps to exactly one handler class via handlerClassName.
 * - Helpers throw on failure; passing tests execute without throwing.
 */

import { DtoBag } from "../../dto/DtoBag";
import { validateUUIDv4String } from "../../utils/uuid";

/**
 * A single handler test case.
 *
 * Notes:
 * - TContext is intentionally generic so the test-runner can decide what it
 *   passes in (e.g., HandlerContext, a thin wrapper, or a richer harness).
 * - Tests pass by not throwing; failures are signaled via thrown Error.
 */
export interface HandlerTestCase<TContext = unknown> {
  /** Stable name for reporting (used in logs / summary). */
  name: string;
  /** Optional human-readable description of the scenario. */
  description?: string;
  /** Toggle without deleting the test. Default is true. */
  enabled?: boolean;
  /**
   * Execute the test.
   *
   * Contract:
   * - The test-runner is responsible for creating a fresh context and
   *   invoking the handler under test before calling `run(...)` if the
   *   scenario expects post-handler assertions.
   * - Tests should throw on failure and remain side-effect free outside the
   *   provided context object.
   */
  run: (ctx: TContext) => Promise<void> | void;
}

/**
 * Base class for handler-level test suites.
 *
 * Each concrete test file exports one subclass whose name and path follow:
 *   <handlerFile>.tests.ts → <HandlerName>Tests extends HandlerTestsBase<Ctx>
 */
export abstract class HandlerTestsBase<TContext = unknown> {
  /**
   * Fully-qualified handler class name, e.g. "CodeBuildUserIdHandler".
   * The test-runner uses this to pair suites with handlers.
   */
  public abstract readonly handlerClassName: string;

  /**
   * Return the list of test cases for this handler.
   * Must return at least one test in normal circumstances.
   */
  public abstract getTests(): HandlerTestCase<TContext>[];

  // ─────────────────────────────────────────────────────────────
  // Tiny reusable helpers — grow this set over time.
  // ─────────────────────────────────────────────────────────────

  /**
   * Ensure a value matches a given regular expression.
   * Throws with a helpful message if the value is empty or does not match.
   */
  protected matchRegex(
    value: unknown,
    pattern: RegExp,
    description?: string
  ): void {
    const label = description?.trim()
      ? description.trim()
      : `value '${String(value)}'`;

    if (value === null || value === undefined) {
      throw new Error(
        `HANDLER_TEST_REGEX_MISMATCH: ${label} is null/undefined and cannot match ${pattern}.`
      );
    }

    const asString = String(value);
    if (!pattern.test(asString)) {
      throw new Error(
        `HANDLER_TEST_REGEX_MISMATCH: ${label} does not match ${pattern}.`
      );
    }
  }

  /**
   * Validate that a string is a proper UUIDv4.
   * Uses the shared validateUUIDv4String() helper; throws on failure.
   */
  protected matchUuidV4(value: unknown): void {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(
        "HANDLER_TEST_UUIDV4_MISSING: Expected a non-empty string to validate as UUIDv4."
      );
    }

    try {
      // This will throw if the value is not a valid UUIDv4.
      validateUUIDv4String(value);
    } catch {
      throw new Error(
        `HANDLER_TEST_UUIDV4_INVALID: Value '${value}' is not a valid UUIDv4.`
      );
    }
  }

  /**
   * Ensure a bag has the expected cardinality.
   *
   * expectation:
   * - "0"   → exactly 0 items
   * - "1"   → exactly 1 item
   * - "ge1" → at least 1 item
   * - "g1"  → strictly greater than 1 (i.e., at least 2 items)
   */
  protected ensureBagCardinality<T>(
    bag: DtoBag<T> | null | undefined,
    expectation: "0" | "1" | "ge1" | "g1"
  ): void {
    const count = bag ? bag.size() : 0;

    switch (expectation) {
      case "0": {
        if (count !== 0) {
          throw new Error(
            `HANDLER_TEST_BAG_CARDINALITY: expected 0 items but found ${count}.`
          );
        }
        return;
      }

      case "1": {
        if (count !== 1) {
          throw new Error(
            `HANDLER_TEST_BAG_CARDINALITY: expected 1 item but found ${count}.`
          );
        }
        return;
      }

      case "ge1": {
        if (count < 1) {
          throw new Error(
            `HANDLER_TEST_BAG_CARDINALITY: expected at least 1 item but found ${count}.`
          );
        }
        return;
      }

      case "g1": {
        if (count < 2) {
          throw new Error(
            `HANDLER_TEST_BAG_CARDINALITY: expected more than 1 item (≥2) but found ${count}.`
          );
        }
        return;
      }

      default: {
        // Defensive: should never happen with the current union type.
        throw new Error(
          `HANDLER_TEST_BAG_CARDINALITY: unsupported expectation '${String(
            expectation
          )}'.`
        );
      }
    }
  }
}
