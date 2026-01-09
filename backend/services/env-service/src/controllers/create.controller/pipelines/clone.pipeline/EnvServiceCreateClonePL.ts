// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/EnvServiceCreateClonePL.ts
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
 * - Domain-named pipeline for env-service CLONE (dtoType="env-service", op="clone").
 *
 * Flow (matches prior index.ts):
 *  1) code.clone              → decode/prepare filter from clone.sourceKey
 *  2) db.readOne.byFilter     → load existing record into clone.existingBag
 *  3) code.patch              → clone + patch new slug; re-bag to ctx["bag"]
 *  4) db.create               → persist new record from ctx["bag"]
 *
 * Notes:
 * - Controller owns DTO hydration at the boundary. This pipeline does not mint ids.
 * - Handler names MUST match handlerName() outputs (shared + local).
 */

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { CodeCloneHandler } from "./code.clone";
import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";
import { CodePatchHandler } from "./code.patch";
import { DbCreateHandler } from "@nv/shared/http/handlers/db.create";

export class EnvServiceCreateClonePL extends PipelineBase {
  public override pipelineName(): string {
    return "EnvServiceCreateClonePL";
  }

  protected override buildPlan(): StepDefTest[] {
    return [
      this.codeClone(),
      this.dbReadOneByFilter(),
      this.codePatch(),
      this.dbCreate(),
    ];
  }

  private codeClone(): StepDefTest {
    return {
      handlerName: "code.clone",
      handlerCtor: CodeCloneHandler,
      expectedTestName: "default",
    };
  }

  private dbReadOneByFilter(): StepDefTest {
    return {
      handlerName: "db.readOne.byFilter",
      handlerCtor: DbReadOneByFilterHandler,
      expectedTestName: "default",
    };
  }

  private codePatch(): StepDefTest {
    return {
      handlerName: "code.patch",
      handlerCtor: CodePatchHandler,
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
  const pl = new EnvServiceCreateClonePL();
  return pl.getStepDefs(runMode as any);
}
