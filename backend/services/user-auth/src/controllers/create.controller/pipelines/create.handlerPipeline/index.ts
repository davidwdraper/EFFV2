// backend/services/user-auth/src/controllers/user-auth.create.controller/pipelines/user-auth.create.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "user-auth" CREATE.
 * - Controller stays thin; *this* module owns orchestration (order only).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

// Reuse your existing handlers (single-handler example is fine)
import { ToBagHandler } from "@nv/shared/http/handlers/toBag";
import { DbCreateHandler } from "@nv/shared/http/handlers/db.create";

// If you later need different steps per dtoType, this file is where you change the order.
export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [
    // 1) Hydrate a DtoBag<IDto> from the JSON body (shared handler)
    new ToBagHandler(ctx, controller),
    // 2) Enforce single-item create and write to DB
    new DbCreateHandler(ctx, controller),
  ];
}
