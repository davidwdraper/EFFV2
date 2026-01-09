// backend/services/env-service/src/controllers/list.controller/pipelines/list.pipeline/EnvServiceListPL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Domain-named pipeline for env-service LIST (dtoType="env-service", op="list").
 *
 * Flow (matches prior index.ts):
 *  1) code.buildFilter   → build DB filter from query/cursor inputs
 *  2) db.read.list       → read list (cursor pagination)
 *
 * Notes:
 * - The legacy index.ts was seeding ctx["list.dtoCtor"] directly.
 * - Under the new rails, any ctx seeding must happen via a seeder step.
 * - Until handlers are refactored, we preserve the contract by seeding list.dtoCtor
 *   via a pipeline seeder step (not by mutating ctx inside buildPlan()).
 */

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { DbEnvServiceDto } from "@nv/shared/dto/db.env-service.dto";

import { CodeBuildFilterHandler } from "./code.buildFilter";
import { DbReadListHandler } from "./db.read.list";

/**
 * Inline/local seeder to preserve the existing ctx contract:
 * - ctx["list.dtoCtor"] = DbEnvServiceDto
 *
 * This keeps handlers unchanged (per plan: handlers last).
 */
class SeedListDtoCtor {
  constructor(
    private readonly ctx: any,
    private readonly _controller: any,
    private readonly _seedSpec: any
  ) {}

  public async run(): Promise<void> {
    this.ctx.set("list.dtoCtor", DbEnvServiceDto);
  }
}

export class EnvServiceListPL extends PipelineBase {
  public override pipelineName(): string {
    return "EnvServiceListPL";
  }

  protected override buildPlan(): StepDefTest[] {
    return [this.seedListDtoCtor(), this.codeBuildFilter(), this.dbReadList()];
  }

  private seedListDtoCtor(): StepDefTest {
    return {
      handlerName: "seed.list.dtoCtor",
      handlerCtor: SeedListDtoCtor as any,
      expectedTestName: "default",
      // Seeder name is resolved by controller loop if present; we supply seederCtor directly.
      seederCtor: SeedListDtoCtor as any,
      seedName: "noop",
      seedSpec: {},
    } as any;
  }

  private codeBuildFilter(): StepDefTest {
    return {
      handlerName: "code.buildFilter",
      handlerCtor: CodeBuildFilterHandler,
      expectedTestName: "default",
    };
  }

  private dbReadList(): StepDefTest {
    return {
      handlerName: "db.read.list",
      handlerCtor: DbReadListHandler,
      expectedTestName: "default",
    };
  }
}

export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new EnvServiceListPL();
  return pl.getStepDefs(runMode as any);
}
