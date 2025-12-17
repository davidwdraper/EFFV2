// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0077 (Test-Runner vNext — Single Orchestrator Handler)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution) [legacy reference]
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Pipeline shell for RUN: returns exactly one step (the orchestrator).
 *
 * Invariants:
 * - getSteps() MUST return a singleton array.
 * - All orchestration (guard, tree-walk, index iteration, writers) lives in CodeRunTestsHandler via svc/RunTests.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { CodeRunTestsHandler } from "./code.runTests";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  return [new CodeRunTestsHandler(ctx, controller)];
}
