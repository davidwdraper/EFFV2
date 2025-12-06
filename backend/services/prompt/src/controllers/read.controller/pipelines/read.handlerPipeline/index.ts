// backend/services/prompt/src/controllers/read.controller/read.handlerPipelines/index.ts
/**
 * Docs:
 * - SOP: DTO-only persistence; query-based single reads use shared handlers.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0064 (Prompts Service, PromptsClient, Prompt-Flush MOS, UI Text Catalog)
 *
 * Purpose:
 * - Define the handler pipeline for prompt read-by-business-key:
 *   GET /api/prompt/v1/prompt/read/:language/:version/:promptKey
 *
 * Flow:
 *   1) QueryBuildFilterHandler
 *        - Reads language/version/promptKey from ctx
 *          (typed values seeded by the controller from req.params).
 *        - Builds Mongo filter: { language, version, promptKey }.
 *        - Writes ctx["bag.query.filter"] (and ctx["query.filter"] for logging).
 *   2) BagPopulateQueryHandler
 *        - Uses ctx["bag.query.dtoCtor"] + ctx["bag.query.filter"]
 *          to read exactly one record into a DtoBag<PromptDto>.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";

import {
  CodeBuildQueryFilterHandler,
  type BuildFilterHandlerOptions,
} from "@nv/shared/http/handlers/code.buildQuery.filter";
import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";

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
    new DbReadOneByFilterHandler(ctx, controller),
  ];
}
