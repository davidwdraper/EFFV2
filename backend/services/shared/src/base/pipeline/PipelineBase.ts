// backend/services/shared/src/base/pipeline/PipelineBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0099 (Strict missing-test semantics; "skipped" must be explicit)
 *
 * Purpose:
 * - Greenfield base for domain pipelines ("*PL") that expose deterministic plans:
 *   - Live plan: ordered step definitions (handler name + ctor)
 *   - Test expectation is carried alongside the step (single source of truth).
 *
 * Critical invariant:
 * - Planning MUST be pure:
 *   - No handler instantiation.
 *   - No runtime work.
 *   - No side effects.
 *
 * Multi-format controller support:
 * - Pipelines MUST NOT assume JSON. Plans are controller-format agnostic.
 * - Therefore, step constructors accept ControllerBase (not ControllerJsonBase).
 */

import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { ControllerBase } from "../controller/ControllerBase";
import type { HandlerBase } from "../../http/handlers/HandlerBase";

export type RunMode = "live" | "test";

export type ExpectedTestName = "default" | "skipped" | string;

export type StepDefTest = {
  /**
   * Stable step identity. Also used as the default test module basename:
   *   <handlerName>.test.js
   */
  handlerName: string;

  /**
   * Live-shaped handler constructor.
   * Instantiated ONLY during scenario execution:
   *   new handlerCtor(scenarioCtx, controller).run()
   *
   * IMPORTANT:
   * - Controller is ControllerBase to support Json/Html/Console/etc controllers.
   * - Handlers that need format-specific features must not assume them here.
   */
  handlerCtor: new (
    ctx: HandlerContext,
    controller: ControllerBase
  ) => HandlerBase;

  /**
   * Test directive for this step.
   * - undefined => treated as "default"
   * - "default" => derive <handlerName>.test.js
   * - "skipped" => intentional opt-out
   * - otherwise => explicit override (non-empty string)
   */
  expectedTestName?: ExpectedTestName;
};

export type StepDefLive = Omit<StepDefTest, "expectedTestName">;

export abstract class PipelineBase {
  public abstract pipelineName(): string;

  /**
   * Pipeline-owned pure plan builder (single source of truth).
   *
   * IMPORTANT:
   * - Must return the TEST-shaped plan (StepDefTest[]) so expectedTestName can
   *   live beside the step identity.
   * - Base will validate it, then produce live/test step defs deterministically.
   */
  protected abstract buildPlan(): StepDefTest[];

  /**
   * Public unified interface (do NOT override in pipelines).
   *
   * - runMode="test": StepDefTest[] (expectedTestName available)
   * - runMode="live": StepDefLive[] (expectedTestName stripped)
   */
  public getStepDefs(runMode: "test"): StepDefTest[];
  public getStepDefs(runMode: "live"): StepDefLive[];
  public getStepDefs(runMode: RunMode = "live"): StepDefLive[] | StepDefTest[] {
    const plan = this.buildPlan();

    // Rails check: validate the full plan once.
    this.validatePlans(plan);

    if (runMode === "test") return plan;

    // live mode: strip expectedTestName from the returned shape
    return plan.map(({ expectedTestName: _ignored, ...live }) => live);
  }

  /**
   * Rails validation for a test-mode plan (StepDefTest[]).
   *
   * - handlerName must be non-empty
   * - handlerName must be unique
   * - handlerCtor must be a function
   * - expectedTestName (if present) must be:
   *   - "default" or "skipped", OR
   *   - a non-empty trimmed string
   *
   * Throws on invalid plan: this is a rails error.
   */
  protected validatePlans(plan: StepDefTest[]): void {
    if (!Array.isArray(plan) || plan.length === 0) {
      throw new Error(
        `PIPELINE_PLAN_INVALID: buildPlan() must return a non-empty StepDef[] (pipeline=${this.pipelineName()}).`
      );
    }

    const seen = new Set<string>();

    for (const s of plan) {
      const name =
        typeof s?.handlerName === "string" ? s.handlerName.trim() : "";

      if (!name) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: StepDef.handlerName is blank (pipeline=${this.pipelineName()}).`
        );
      }

      if (seen.has(name)) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: duplicate StepDef.handlerName="${name}" (pipeline=${this.pipelineName()}).`
        );
      }

      if (typeof (s as any)?.handlerCtor !== "function") {
        throw new Error(
          `PIPELINE_PLAN_INVALID: StepDef.handlerCtor missing/invalid for handlerName="${name}" (pipeline=${this.pipelineName()}).`
        );
      }

      const etnRaw =
        s.expectedTestName === undefined
          ? "default"
          : s.expectedTestName === "default" || s.expectedTestName === "skipped"
          ? s.expectedTestName
          : typeof s.expectedTestName === "string"
          ? s.expectedTestName.trim()
          : "";

      if (!etnRaw) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: expectedTestName is blank for handlerName="${name}" (pipeline=${this.pipelineName()}).`
        );
      }

      seen.add(name);
    }
  }

  /**
   * Normalize the per-step expected test name directive.
   * Runner uses this for strict missing-test semantics (ADR-0099).
   */
  public static normalizeExpectedTestName(v: unknown): string {
    if (v === "default" || v === "skipped") return v;
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s : "default";
  }
}
