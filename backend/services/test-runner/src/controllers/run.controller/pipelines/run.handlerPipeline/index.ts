// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Define ordered handler steps for the test-runner RUN pipeline.
 * - Controller stays thin; this module owns orchestration (order only).
 *
 * Invariants:
 * - Handlers are single-purpose and constructed per request via this factory.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { CodeTreeWalkerHandler } from "./code.treeWalker";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  return [
    // 1) Walk the code tree to discover pipelines/handlers suitable for testing.
    new CodeTreeWalkerHandler(ctx, controller),
  ];
}
