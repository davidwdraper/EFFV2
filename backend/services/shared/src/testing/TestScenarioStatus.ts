// backend/services/shared/src/testing/TestScenarioStatus.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0094 (Test Scenario Error Handling and Logging)
 *
 * Purpose (single concern):
 * - Canonical, explicit state container for a single test scenario’s intent + observed execution.
 *
 * Non-goals:
 * - NOT an ALS / adaptive logging system.
 * - NOT a logger.
 *
 * Invariants:
 * - One scenario => one TestScenarioStatus instance.
 * - No “expectErrors” flags anywhere; expectation is modeled here only.
 * - Deterministic classification: outcome is computed from explicit inputs.
 */

export type TestScenarioId = string;

export type TestExpectedMode =
  | "success" // scenario expects a clean run (no thrown error; no rails error)
  | "failure"; // scenario expects a failure (either rails-failure w/o throw, or throw)

export type TestOutcomeCode =
  | 1 // Passed — no error caught, success expected (green)
  | 2 // Passed — no error caught, failure expected (green)
  | 3 // Failed — assertions/rails mismatch without thrown error (red, INFO)
  | 4 // Passed — caught expected error (green)
  | 5; // Failed — caught unexpected error OR infrastructure failure (red, ERROR)

export type TestOutcomeColor = "green" | "red";
export type TestOutcomeLogLevel = "info" | "error";

export type TestScenarioOutcome = {
  code: TestOutcomeCode;
  color: TestOutcomeColor;
  logLevel: TestOutcomeLogLevel;
  abortPipeline: boolean;
};

export type TestScenarioStatusSeed = {
  scenarioId: TestScenarioId;
  scenarioName: string;
  expected: TestExpectedMode;

  /**
   * Optional “allowed failures” list for cases like dupes where you expect failure
   * but want to enforce *which* failure signature is acceptable.
   */
  acceptableFailureTags?: string[];
};

export type RailsSnapshot = {
  handlerStatus?: string; // "ok" | "error" (string on purpose; rails own the enum)
  httpStatus?: number; // e.g., 200, 409, 500
};

export type CaughtErrorInfo = {
  name?: string;
  message?: string;
  stack?: string;
  isInfrastructure: boolean;
  tags?: string[];
};

export class TestScenarioStatus {
  private readonly _scenarioId: TestScenarioId;
  private readonly _scenarioName: string;
  private readonly _expected: TestExpectedMode;
  private readonly _acceptableFailureTags: string[];

  private _caught?: CaughtErrorInfo;
  private _notes: string[];
  private _assertionFailures: string[];

  private _finalized: boolean;
  private _outcome?: TestScenarioOutcome;
  private _rails?: RailsSnapshot;

  public constructor(seed: TestScenarioStatusSeed) {
    this._scenarioId = seed.scenarioId;
    this._scenarioName = seed.scenarioName;
    this._expected = seed.expected;
    this._acceptableFailureTags = seed.acceptableFailureTags ?? [];

    this._caught = undefined;
    this._notes = [];
    this._assertionFailures = [];
    this._finalized = false;
  }

  // -------------------- identity / intent --------------------

  public scenarioId(): TestScenarioId {
    return this._scenarioId;
  }

  public scenarioName(): string {
    return this._scenarioName;
  }

  public expected(): TestExpectedMode {
    return this._expected;
  }

  public acceptableFailureTags(): string[] {
    return [...this._acceptableFailureTags];
  }

  // -------------------- mutation (catch + notes + assertions) --------------------

  public addNote(note: string): void {
    this._notes.push(note);
  }

  public notes(): string[] {
    return [...this._notes];
  }

  /**
   * Record a deterministic test assertion failure without throwing.
   * This keeps ADR-0094 semantics clean: inner catch is for execution errors,
   * assertion failures are “no-throw” failures and should NOT abort the pipeline.
   */
  public recordAssertionFailure(message: string): void {
    const msg = typeof message === "string" ? message.trim() : "";
    if (!msg) return;
    this._assertionFailures.push(msg);
  }

  public assertionFailures(): string[] {
    return [...this._assertionFailures];
  }

  public hasAssertionFailures(): boolean {
    return this._assertionFailures.length > 0;
  }

  public recordInnerCatch(err: unknown, tags?: string[]): void {
    this._caught = TestScenarioStatus.toCaughtErrorInfo({
      isInfrastructure: false,
      err,
      tags,
    });
  }

  public recordOuterCatch(err: unknown, tags?: string[]): void {
    this._caught = TestScenarioStatus.toCaughtErrorInfo({
      isInfrastructure: true,
      err,
      tags,
    });
  }

  public caught(): CaughtErrorInfo | undefined {
    if (!this._caught) return undefined;
    return {
      ...this._caught,
      tags: this._caught.tags ? [...this._caught.tags] : undefined,
    };
  }

  // -------------------- finalize + classification --------------------

  public finalize(opts: {
    rails?: RailsSnapshot;
    failureTagsObserved?: string[];
  }): TestScenarioOutcome {
    if (this._finalized && this._outcome) return this._outcome;

    this._rails = opts.rails;
    const observedTags = opts.failureTagsObserved ?? [];

    const base = TestScenarioStatus.computeOutcome({
      expected: this._expected,
      caught: this._caught,
      acceptableTags: this._acceptableFailureTags,
      observedTags,
      rails: opts.rails,
    });

    // Assertion failures are red, but NOT infrastructure: do not abort the whole run.
    // They map to outcome code 3 (failed, no throw).
    const outcome =
      this._assertionFailures.length > 0 && base.code !== 5
        ? {
            code: 3 as const,
            color: "red" as const,
            logLevel: "info" as const,
            abortPipeline: false,
          }
        : base;

    this._outcome = outcome;
    this._finalized = true;
    return outcome;
  }

  public isFinalized(): boolean {
    return this._finalized;
  }

  public outcome(): TestScenarioOutcome | undefined {
    return this._outcome;
  }

  public rails(): RailsSnapshot | undefined {
    return this._rails ? { ...this._rails } : undefined;
  }

  // -------------------- pure helpers --------------------

  private static toCaughtErrorInfo(args: {
    isInfrastructure: boolean;
    err: unknown;
    tags?: string[];
  }): CaughtErrorInfo {
    const { isInfrastructure, err, tags } = args;

    if (err instanceof Error) {
      return {
        isInfrastructure,
        name: err.name,
        message: err.message,
        stack: err.stack,
        tags: tags && tags.length ? [...tags] : undefined,
      };
    }

    return {
      isInfrastructure,
      name: "NonErrorThrow",
      message: typeof err === "string" ? err : "Non-Error thrown",
      stack: undefined,
      tags: tags && tags.length ? [...tags] : undefined,
    };
  }

  public static computeOutcome(args: {
    expected: TestExpectedMode;
    caught?: CaughtErrorInfo;
    acceptableTags: string[];
    observedTags: string[];
    rails?: RailsSnapshot;
  }): TestScenarioOutcome {
    const railsFailure = TestScenarioStatus.isRailsFailure(args.rails);
    const threw = !!args.caught;

    const tagsOk = TestScenarioStatus.isTagsAcceptable({
      acceptable: args.acceptableTags,
      observed: [...(args.caught?.tags ?? []), ...args.observedTags],
      expected: args.expected,
    });

    if (args.caught?.isInfrastructure) {
      return { code: 5, color: "red", logLevel: "error", abortPipeline: true };
    }

    if (args.expected === "success") {
      if (!threw && !railsFailure) {
        return {
          code: 1,
          color: "green",
          logLevel: "info",
          abortPipeline: false,
        };
      }
      return { code: 5, color: "red", logLevel: "error", abortPipeline: true };
    }

    // expected failure
    if (threw) {
      if (tagsOk) {
        return {
          code: 4,
          color: "green",
          logLevel: "info",
          abortPipeline: false,
        };
      }
      return { code: 5, color: "red", logLevel: "error", abortPipeline: true };
    }

    // no throw
    if (railsFailure) {
      return {
        code: 2,
        color: "green",
        logLevel: "info",
        abortPipeline: false,
      };
    }

    // failure expected but nothing failed: still “green” per ADR-0094 (#2)
    return { code: 2, color: "green", logLevel: "info", abortPipeline: false };
  }

  private static isRailsFailure(rails?: RailsSnapshot): boolean {
    if (!rails) return false;
    if (
      typeof rails.handlerStatus === "string" &&
      rails.handlerStatus.toLowerCase() === "error"
    )
      return true;
    if (typeof rails.httpStatus === "number" && rails.httpStatus >= 400)
      return true;
    return false;
  }

  private static isTagsAcceptable(args: {
    acceptable: string[];
    observed: string[];
    expected: TestExpectedMode;
  }): boolean {
    if (args.expected !== "failure") return true;
    if (!args.acceptable.length) return true;

    const observedSet = new Set(args.observed.filter(Boolean));
    return args.acceptable.some((t) => observedSet.has(t));
  }
}
