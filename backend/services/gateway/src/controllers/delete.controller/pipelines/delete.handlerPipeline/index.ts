// backend/services/gateway/src/controllers/gateway.delete.controller/pipelines/gateway.delete.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "gateway" DELETE.
 * - Controller stays thin; this module owns orchestration (order only).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

// Reuse existing handler; if you later relocate handlers under the pipeline folder,
// just adjust this import path.
import { DbDeleteByIdHandler } from "@nv/shared/http/handlers/dbDeleteById.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [new DbDeleteByIdHandler(ctx, controller)];
}
