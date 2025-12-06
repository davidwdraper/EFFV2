// backend/services/env-service/src/controllers/list.controller/pipelines/list.pipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "env-service" LIST.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";
import { CodeBuildFilterHandler } from "./code.buildFilter";
import { DbReadListHandler } from "./db.read.list";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor used by handlers
  ctx.set("list.dtoCtor", EnvServiceDto);

  return [
    new CodeBuildFilterHandler(ctx, controller),
    new DbReadListHandler(ctx, controller),
  ];
}
