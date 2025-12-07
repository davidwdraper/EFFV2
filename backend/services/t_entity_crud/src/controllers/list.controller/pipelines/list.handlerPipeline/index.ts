// backend/services/t_entity_crud/src/controllers/xxx.list.controller/pipelines/xxx.list.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "xxx" LIST.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { BuildFilterHandlerOptions } from "@nv/shared/http/handlers/code.buildQuery.filter";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { XxxDto } from "@nv/shared/dto/xxx.dto";
import { CodeBuildQueryFilterHandler } from "@nv/shared/http/handlers/code.buildQuery.filter";
import { DbReadListHandler } from "@nv/shared/http/handlers/db.read.list";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerJsonBase
): HandlerBase[] {
  const filterOpts: BuildFilterHandlerOptions = {
    fields: [
      {
        // language: e.g. "en-US"
        target: "language",
        source: "ctx",
        key: "language",
        required: true,
      },
      {
        // version: numeric prompt version
        target: "version",
        source: "ctx",
        key: "version",
        required: true,
      },
      {
        // promptKey: e.g. "auth.password.too-weak"
        target: "promptKey",
        source: "ctx",
        key: "promptKey",
        required: true,
      },
    ],
    // For logging / idKey construction only; does NOT touch Mongo _id.
    idKeyFields: ["language", "version", "promptKey"],
    idKeyJoinChar: "@",
  };

  return [
    new CodeBuildQueryFilterHandler(ctx, controller, filterOpts),
    new DbReadListHandler(ctx, controller),
  ];
}
