// backend/services/svcconfig/src/controllers/svcconfig.list.controller/pipelines/svcconfig.list.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "svcconfig" LIST.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";
import { CodeQueryBuilder } from "./code.queryBuilder";
import { DbReadHandler } from "./db.read";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor used by handlers
  ctx.set("list.dtoCtor", SvcconfigDto);

  return [
    new CodeQueryBuilder(ctx, controller),
    new DbReadHandler(ctx, controller),
  ];
}
