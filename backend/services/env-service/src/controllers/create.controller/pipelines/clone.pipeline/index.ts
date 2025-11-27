// backend/services/env-service/src/controllers/create.controller/pipelines/clone.pipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "env-service" CLONE (op="clone").
 * - Flow:
 *   1) Build filter for source record from clone.sourceKey.
 *   2) Shared BagPopulateQueryHandler reads existing DTO into clone.existingBag.
 *   3) Clone + patch slug into a new singleton bag at ctx["bag"].
 *   4) Shared create write handler persists the new record.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { EnvServiceCloneBuildFilterHandler } from "./clone.buildFilter.handler";
import { BagPopulateQueryHandler } from "@nv/shared/http/handlers/bag.populate.query.handler";
import { EnvServiceClonePatchHandler } from "./clone.patch.handler";
import { BagToDbCreateHandler } from "@nv/shared/http/handlers/bag.toDb.create.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [
    // 1) Decode slug@version@env → bag.query.* config.
    new EnvServiceCloneBuildFilterHandler(ctx, controller),
    // 2) Generic DB → bag handler; writes clone.existingBag.
    new BagPopulateQueryHandler(ctx, controller),
    // 3) Clone + patch new slug, re-bag to ctx["bag"].
    new EnvServiceClonePatchHandler(ctx, controller),
    // 4) Shared create write (DbWriter via BagToDbCreateHandler).
    new BagToDbCreateHandler(ctx, controller),
  ];
}
