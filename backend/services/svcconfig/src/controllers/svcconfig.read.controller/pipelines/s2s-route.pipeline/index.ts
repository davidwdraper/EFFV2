// backend/services/svcconfig/src/controllers/svcconfig.read.controller/pipelines/svcconfig.s2s-route/index.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; query-based single reads use shared handlers.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0061 (svcconfig s2s-route — S2S target resolution)
 *
 * Purpose:
 * - Define the handler pipeline for svcconfig s2s-route:
 *   GET /api/svcconfig/v1/svcconfig/s2s-route?env=&slug=&majorVersion=
 *
 * Flow:
 *   1) QueryBuildFilterHandler
 *        - Reads env/slug/majorVersion from ctx (typed values seeded by controller).
 *        - Builds Mongo filter: { env, slug, majorVersion }.
 *        - Writes ctx["bag.query.filter"] (and ctx["query.filter"] for logging).
 *   2) BagPopulateQueryHandler
 *        - Uses ctx["bag.query.dtoCtor"] + ctx["bag.query.filter"]
 *          to read exactly one record into a DtoBag.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";

import {
  QueryBuildFilterHandler,
  type BuildFilterHandlerOptions,
} from "@nv/shared/http/handlers/query.buildFilter.handler";
import { BagPopulateQueryHandler } from "@nv/shared/http/handlers/bag.populate.query.handler";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerBase
): HandlerBase[] {
  const filterOpts: BuildFilterHandlerOptions = {
    fields: [
      {
        target: "env",
        source: "ctx",
        key: "env",
        required: true,
      },
      {
        target: "slug",
        source: "ctx",
        key: "slug",
        required: true,
      },
      {
        target: "majorVersion",
        source: "ctx",
        key: "majorVersion",
        required: true,
      },
    ],
    idKeyFields: ["env", "slug", "majorVersion"],
    idKeyJoinChar: "@",
  };

  return [
    new QueryBuildFilterHandler(ctx, controller, filterOpts),
    new BagPopulateQueryHandler(ctx, controller),
  ];
}
