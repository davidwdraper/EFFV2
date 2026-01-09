// backend/services/t_entity_crud/src/controllers/xxx.read.controller/pipelines/xxx.read.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "xxx" READ (by id).
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { XxxDto } from "@nv/shared/dto/db.xxx.dto";
import { DbReadByIdHandler } from "@nv/shared/http/handlers/db.read.byId";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed required inputs for the read handler
  ctx.set("read.dtoCtor", XxxDto);

  return [new DbReadByIdHandler(ctx, controller)];
}
