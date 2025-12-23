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
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { CodeCloneHandler } from "./code.clone";
import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";
import { CodePatchHandler } from "./code.patch";
import { DbCreateHandler } from "@nv/shared/http/handlers/db.create";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  return [
    // 1) Decode slug@version@env → bag.query.* config.
    new CodeCloneHandler(ctx, controller),
    // 2) Generic DB → bag handler; writes clone.existingBag.
    new DbReadOneByFilterHandler(ctx, controller),
    // 3) Clone + patch new slug, re-bag to ctx["bag"].
    new CodePatchHandler(ctx, controller),
    // 4) Shared create write (DbWriter via BagToDbCreateHandler).
    new DbCreateHandler(ctx, controller),
  ];
}
