// backend/services/shared/src/base/pipeline/PipelineBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0099 (Strict missing-test semantics; "skipped" must be explicit)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Greenfield base for domain pipelines ("*PL") that expose deterministic plans:
 *   - Steps are seeder→handler PAIRS (ADR-0101).
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
 * - Therefore, constructors accept ControllerBase (not ControllerJsonBase).
 *
 * TypeScript notes:
 * - handlerInit is `any` intentionally (constructor assignability rules).
 * - seedSpec is inert data only; interpreted by seeders at run time.
 */

import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { ControllerBase } from "../controller/ControllerBase";
import type { HandlerBase } from "../../http/handlers/HandlerBase";
import type {
  HandlerSeederBase,
  SeedSpec,
} from "../../http/handlers/seeding/handlerSeeder";

export type RunMode = "live" | "test";

export type ExpectedTestName = "default" | "skipped" | string;

export type SeederCtor = new (
  ctx: HandlerContext,
  controller: ControllerBase,
  seedSpec?: SeedSpec
) => HandlerSeederBase;

export type StepDefTest = {
  /**
   * Stable step identity. Also used as the default test module basename:
   *   <handlerName>.test.js
   *
   * NOTE:
   * - This identifies the HANDLER in the pair.
   * - The seeder is addressed separately via seedName (mainly for logging).
   */
  handlerName: string;

  /**
   * Seeder identity for logging/debugging.
   * Convention: `seed.<handlerName>`
   */
  seedName: string;

  /**
   * Declarative seed spec interpreted by the seeder.
   * MUST be inert data (no functions, no runtime reads).
   *
   * Noop seeding is explicit:
   * - seedSpec.rules = []
   */
  seedSpec: SeedSpec;

  /**
   * Optional seeder override constructor.
   * If omitted, controller/test-runner will use the default HandlerSeeder.
   */
  seederCtor?: SeederCtor;

  /**
   * Live-shaped handler constructor.
   * Instantiated ONLY during scenario execution:
   *   new handlerCtor(scenarioCtx, controller, handlerInit).run()
   */
  handlerCtor: new (
    ctx: HandlerContext,
    controller: ControllerBase,
    handlerInit?: any
  ) => HandlerBase;

  /**
   * Optional static init payload for parameterized handlers.
   * MUST be inert data.
   */
  handlerInit?: any;

  /**
   * Test directive for this handler step.
   * - undefined => treated as "default"
   * - "default" => derive <handlerName>.test.js
   * - "skipped" => intentional opt-out
   * - otherwise => explicit override basename
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

    this.validatePlans(plan);

    if (runMode === "test") return plan;

    return plan.map(({ expectedTestName: _ignored, ...live }) => live);
  }

  /**
   * Rails validation for a test-mode plan (StepDefTest[]).
   *
   * - handlerName non-empty + unique
   * - seedName non-empty
   * - seedSpec present (rules array exists; may be empty)
   * - handlerCtor is a function
   * - expectedTestName is "default"/"skipped" or a non-empty string
   */
  protected validatePlans(plan: StepDefTest[]): void {
    if (!Array.isArray(plan) || plan.length === 0) {
      throw new Error(
        `PIPELINE_PLAN_INVALID: buildPlan() must return a non-empty StepDef[] (pipeline=${this.pipelineName()}).`
      );
    }

    const seenHandlers = new Set<string>();

    for (const s of plan) {
      const handlerName =
        typeof s?.handlerName === "string" ? s.handlerName.trim() : "";

      if (!handlerName) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: StepDef.handlerName is blank (pipeline=${this.pipelineName()}).`
        );
      }

      if (seenHandlers.has(handlerName)) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: duplicate StepDef.handlerName="${handlerName}" (pipeline=${this.pipelineName()}).`
        );
      }

      const seedName = typeof s?.seedName === "string" ? s.seedName.trim() : "";
      if (!seedName) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: StepDef.seedName is blank for handlerName="${handlerName}" (pipeline=${this.pipelineName()}).`
        );
      }

      const rules = (s as any)?.seedSpec?.rules;
      if (!Array.isArray(rules)) {
        throw new Error(
          `PIPELINE_PLAN_INVALID: StepDef.seedSpec.rules must be an array for handlerName="${handlerName}" (pipeline=${this.pipelineName()}).`
        );
      }

      if (typeof (s as any)?.handlerCtor !== "function") {
        throw new Error(
          `PIPELINE_PLAN_INVALID: StepDef.handlerCtor missing/invalid for handlerName="${handlerName}" (pipeline=${this.pipelineName()}).`
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
          `PIPELINE_PLAN_INVALID: expectedTestName is blank for handlerName="${handlerName}" (pipeline=${this.pipelineName()}).`
        );
      }

      seenHandlers.add(handlerName);
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
