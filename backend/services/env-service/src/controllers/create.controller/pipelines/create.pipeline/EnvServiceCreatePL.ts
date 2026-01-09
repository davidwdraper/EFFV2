// backend/services/env-service/src/controllers/env-service.create.controller/pipelines/env-service.create.handlerPipeline/EnvServiceCreatePL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 * - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *
 * Purpose:
 * - Domain-named pipeline for env-service CREATE (dtoType="env-service", op="create").
 *
 * Flow (matches prior index.ts):
 *  1) toBag               → hydrate DtoBag<IDto> from inbound JSON
 *  2) db.create           → enforce single-item create + persist
 *
 * Invariants:
 * - Controller owns boundary concerns only; orchestration lives here.
 * - No ID minting occurs in this pipeline (Scenario B edge hydration).
 * - Handler names must exactly match handlerName() contracts.
 */

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { ToBagHandler } from "@nv/shared/http/handlers/toBag";
import { DbCreateHandler } from "@nv/shared/http/handlers/db.create";

export class EnvServiceCreatePL extends PipelineBase {
  public override pipelineName(): string {
    return "EnvServiceCreatePL";
  }

  protected override buildPlan(): StepDefTest[] {
    return [this.toBag(), this.dbCreate()];
  }

  private toBag(): StepDefTest {
    return {
      handlerName: "toBag",
      handlerCtor: ToBagHandler,
      expectedTestName: "default",
    };
  }

  private dbCreate(): StepDefTest {
    return {
      handlerName: "db.create",
      handlerCtor: DbCreateHandler,
      expectedTestName: "default",
    };
  }
}

export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new EnvServiceCreatePL();
  return pl.getStepDefs(runMode as any);
}
