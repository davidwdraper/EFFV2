// backend/services/svcconfig/src/controllers/svcconfig.read.controller/pipelines/svcconfig.read.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "svcconfig" READ (by id).
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";
import { DbReadByIdHandler } from "@nv/shared/http/handlers/db.read.byId";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed required inputs for the read handler
  ctx.set("read.dtoCtor", SvcconfigDto);

  return [new DbReadByIdHandler(ctx, controller)];
}
