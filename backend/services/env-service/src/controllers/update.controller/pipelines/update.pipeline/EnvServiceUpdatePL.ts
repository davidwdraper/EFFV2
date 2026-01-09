// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/EnvServiceUpdatePL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Domain-named pipeline for env-service UPDATE (dtoType="env-service", op="update").
 *
 * Flow (matches prior index.ts):
 *  1) toBag            → hydrate inbound patch bag
 *  2) db.readExisting  → load existing DTO as a bag (ctx["existingBag"])
 *  3) code.patch       → apply patch; write UPDATED singleton bag to ctx["bag"]
 *  4) db.update        → persist updated singleton
 *
 * Notes:
 * - Legacy index.ts seeded ctx["update.dtoCtor"] directly.
 * - Handlers are last, so we preserve that contract by seeding via a seeder
 *   attached to the first rung (seeder→handler pair).
 */

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { DbEnvServiceDto } from "@nv/shared/dto/db.env-service.dto";

// Shared preflight
import { ToBagHandler } from "@nv/shared/http/handlers/toBag";

// Update-specific handlers
import { DbReadExistingHandler } from "./db.readExisting";
import { CodePatchHandler } from "@nv/shared/http/handlers/code.patch";
import { DbUpdateHandler } from "./db.update";

/**
 * Seeder: preserve existing ctx contract for UPDATE handlers:
 * - ctx["update.dtoCtor"] = DbEnvServiceDto
 */
class SeedUpdateDtoCtor {
  constructor(
    private readonly ctx: any,
    private readonly _controller: any,
    private readonly _seedSpec: any
  ) {}

  public async run(): Promise<void> {
    this.ctx.set("update.dtoCtor", DbEnvServiceDto);
  }
}

export class EnvServiceUpdatePL extends PipelineBase {
  public override pipelineName(): string {
    return "EnvServiceUpdatePL";
  }

  protected override buildPlan(): StepDefTest[] {
    return [
      this.toBag(),
      this.dbReadExisting(),
      this.codePatch(),
      this.dbUpdate(),
    ];
  }

  private toBag(): StepDefTest {
    return {
      // Seed runs immediately before ToBagHandler (ADR-0101 pair)
      seedName: "noop",
      seederCtor: SeedUpdateDtoCtor as any,
      seedSpec: {},

      handlerName: "toBag",
      handlerCtor: ToBagHandler,
      expectedTestName: "default",
    } as any;
  }

  private dbReadExisting(): StepDefTest {
    return {
      handlerName: "db.readExisting",
      handlerCtor: DbReadExistingHandler,
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

  private dbUpdate(): StepDefTest {
    return {
      handlerName: "db.update",
      handlerCtor: DbUpdateHandler,
      expectedTestName: "default",
    };
  }
}

export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new EnvServiceUpdatePL();
  return pl.getStepDefs(runMode as any);
}
