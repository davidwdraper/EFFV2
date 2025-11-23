// backend/services/svcconfig/src/controllers/svcconfig.read.controller/pipelines/s2s-route.pipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 * - ADR-0061 (svcconfig s2s-route — S2S target resolution)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "svcconfig" op "s2s-route".
 * - Build Mongo filter { env, slug, version } dynamically via a shared handler,
 *   then let the shared bag.query handler perform DbReader.readOneBag().
 *
 * Route shape:
 *   GET /api/svcconfig/v1/svcconfig/s2s-route/:slug/:version
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/ControllerBase";

import {
  QueryBuildFilterHandler,
  type FilterFieldSpec,
} from "@nv/shared/http/handlers/query.buildFilter.handler";
import { BagPopulateQueryHandler } from "@nv/shared/http/handlers/bag.populate.query.handler";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerBase
): Array<QueryBuildFilterHandler | BagPopulateQueryHandler> {
  // s2s-route must resolve exactly one svcconfig record per (env, slug, version).
  ctx.set("ensureSingleton", true);
  ctx.set("validateReads", false);

  const fields: FilterFieldSpec[] = [
    // env from NV_ENV in svcEnv
    {
      target: "env",
      source: "envVar",
      key: "NV_ENV",
      required: true,
    },
    // slug from route param
    {
      target: "slug",
      source: "param",
      key: "slug",
      required: true,
    },
    // version from route param (adjust target name if your DTO uses majorVersion instead)
    {
      target: "version",
      source: "param",
      key: "version",
      required: true,
    },
  ];

  const buildFilterHandler = new QueryBuildFilterHandler(ctx, controller, {
    fields,
    idKeyFields: ["env", "slug", "version"],
    idKeyJoinChar: "@",
  });

  return [
    buildFilterHandler,
    // Shared handler should:
    // - read ctx["query.filter"]
    // - call DbReader.readOneBag({ filter })
    // - enforce ensureSingleton
    // - hydrate and stash bag/result
    new BagPopulateQueryHandler(ctx, controller),
  ];
}
