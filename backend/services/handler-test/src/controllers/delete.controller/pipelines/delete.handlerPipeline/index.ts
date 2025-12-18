// backend/services/handler-test/src/controllers/handler-test.delete.controller/pipelines/handler-test.delete.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "handler-test" DELETE.
 * - Controller stays thin; this module owns orchestration (order only).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

// Reuse existing handler; if you later relocate handlers under the pipeline folder,
// just adjust this import path.
import { DbDeleteByIdHandler } from "@nv/shared/http/handlers/db.delete.byId";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  return [new DbDeleteByIdHandler(ctx, controller)];
}
