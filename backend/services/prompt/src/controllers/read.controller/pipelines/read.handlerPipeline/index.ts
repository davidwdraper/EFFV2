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
 *   1) CodeBuildQueryFilterHandler
 *        - Reads language/version/promptKey from ctx (seeded by controller).
 *        - Builds Mongo filter: { language, version, promptKey }.
 *        - Writes ctx["bag.query.filter"].
 *   2) DbReadOneByFilterHandler
 *        - Uses ctx["bag.query.dtoCtor"] + ctx["bag.query.filter"]
 *          to read exactly one record into ctx["bag"] (DtoBag<PromptDto>).
 *   3) CodePromptEnsureUndefinedPlaceholderHandler
 *        - If ctx["bag"] is empty (prompt missing), fire-and-forget a placeholder insert:
 *            template="" and undefined=true
 *          so Ops can query undefined prompts via indexed field.
 *        - Does not change response behavior: caller still receives empty items[].
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";

import {
  CodeBuildQueryFilterHandler,
  type BuildFilterHandlerOptions,
} from "@nv/shared/http/handlers/code.buildQuery.filter";

import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";
import { DbEnsureUndefinedPlaceholderHandler } from "./db.ensureUndefinedPlaceholder";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerJsonBase
): HandlerBase[] {
  return [
    new CodeBuildQueryFilterHandler(ctx, controller, filterOpts),
    new DbReadOneByFilterHandler(ctx, controller),
    new DbEnsureUndefinedPlaceholderHandler(ctx, controller),
  ];
}
