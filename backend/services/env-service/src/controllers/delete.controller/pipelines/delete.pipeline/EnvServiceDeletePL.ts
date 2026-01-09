// backend/services/env-service/src/controllers/delete.controller/pipelines/delete.pipeline/EnvServiceDeletePL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Domain-named pipeline for env-service DELETE (dtoType="env-service", op="delete").
 *
 * Flow (matches prior index.ts):
 *  1) db.delete.byId   → idempotent delete by id
 *
 * Notes:
 * - Controller remains thin; orchestration lives here.
 * - Handler name must match handlerName() contract.
 */

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { DbDeleteByIdHandler } from "@nv/shared/http/handlers/db.delete.byId";

export class EnvServiceDeletePL extends PipelineBase {
  public override pipelineName(): string {
    return "EnvServiceDeletePL";
  }

  protected override buildPlan(): StepDefTest[] {
    return [this.dbDeleteById()];
  }

  private dbDeleteById(): StepDefTest {
    return {
      handlerName: "db.delete.byId",
      handlerCtor: DbDeleteByIdHandler,
      expectedTestName: "default",
    };
  }
}

export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new EnvServiceDeletePL();
  return pl.getStepDefs(runMode as any);
}
