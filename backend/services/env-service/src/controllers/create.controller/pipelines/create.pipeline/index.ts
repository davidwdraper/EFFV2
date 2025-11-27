// backend/services/env-service/src/controllers/env-service.create.controller/pipelines/env-service.create.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "env-service" CREATE (op="create").
 * - Controller stays thin; *this* module owns orchestration (order only).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

// Reuse your existing handlers (single-handler example is fine)
import { BagPopulateGetHandler } from "@nv/shared/http/handlers/bag.populate.get.handler";
import { BagToDbCreateHandler } from "@nv/shared/http/handlers/bag.toDb.create.handler";

// If you later need different steps per dtoType, this file is where you change the order.
export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [
    // 1) Hydrate a DtoBag<IDto> from the JSON body (shared handler)
    new BagPopulateGetHandler(ctx, controller),
    // 2) Enforce single-item create and write to DB
    new BagToDbCreateHandler(ctx, controller),
  ];
}
