// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/EnvServiceReadPL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Domain-named pipeline for env-service CONFIG READ (dtoType="env-service", op="config").
 *
 * Flow (matches prior index.ts):
 *  0) code.guard.serviceRoot  → forbid direct reads of reserved "service-root"
 *  1) seed.mongoConfig        → override mongo config for config DB (infra)
 *  2) seed.filter1            → seed filter for service-root (root bag)
 *  3) db.readOne.byFilter     → read root config
 *  4) seed.filter2            → seed filter for requested service (service bag)
 *  5) db.readOne.byFilter     → read service config
 *  6) code.mergeVars          → merge vars; write effective singleton bag to ctx["bag"]
 *
 * Notes:
 * - These “seed.*” steps are implemented today as handlers (Seed*Handler).
 * - Handlers are last in the refactor order, so we preserve that shape for now.
 */

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";

import { CodeGuardServiceRootHandler } from "./code.guard.serviceRoot";
import { SeedMongoConfigHandler } from "./seed.mongoConfig";
import { SeedFilter1Handler } from "./seed.filter1";
import { SeedFilter2Handler } from "./seed.filter2";
import { CodeMergeVarsHandler } from "./code.mergeVars";

export class EnvServiceReadPL extends PipelineBase {
  public override pipelineName(): string {
    return "EnvServiceReadPL";
  }

  protected override buildPlan(): StepDefTest[] {
    return [
      this.codeGuardServiceRoot(),
      this.seedMongoConfig(),
      this.seedFilter1(),
      this.dbReadOneByFilterRoot(),
      this.seedFilter2(),
      this.dbReadOneByFilterService(),
      this.codeMergeVars(),
    ];
  }

  private codeGuardServiceRoot(): StepDefTest {
    return {
      handlerName: "code.guard.serviceRoot",
      handlerCtor: CodeGuardServiceRootHandler,
      expectedTestName: "default",
    };
  }

  private seedMongoConfig(): StepDefTest {
    return {
      handlerName: "seed.mongoConfig",
      handlerCtor: SeedMongoConfigHandler,
      expectedTestName: "default",
    };
  }

  private seedFilter1(): StepDefTest {
    return {
      handlerName: "seed.filter1",
      handlerCtor: SeedFilter1Handler,
      expectedTestName: "default",
    };
  }

  private dbReadOneByFilterRoot(): StepDefTest {
    return {
      handlerName: "db.readOne.byFilter",
      handlerCtor: DbReadOneByFilterHandler,
      expectedTestName: "default",
    };
  }

  private seedFilter2(): StepDefTest {
    return {
      handlerName: "seed.filter2",
      handlerCtor: SeedFilter2Handler,
      expectedTestName: "default",
    };
  }

  private dbReadOneByFilterService(): StepDefTest {
    // Same handler, second time. The preceding seed step controls which filter/bag is active.
    return {
      handlerName: "db.readOne.byFilter",
      handlerCtor: DbReadOneByFilterHandler,
      expectedTestName: "default",
    };
  }

  private codeMergeVars(): StepDefTest {
    return {
      handlerName: "code.mergeVars",
      handlerCtor: CodeMergeVarsHandler,
      expectedTestName: "default",
    };
  }
}

export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new EnvServiceReadPL();
  return pl.getStepDefs(runMode as any);
}
