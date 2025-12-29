// backend/services/prompt/src/controllers/read.controller/read.handlerPipelines/index.ts
/**
 * Docs:
 * - SOP: index.ts defines and orders handlers only (no seeding logic).
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence; reads hydrate DTOs)
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0064 (Prompts Service, PromptsClient, Prompt-Flush MOS, UI Text Catalog)
 *   - ADR-0087 (Index pipelines; seed.filter handlers)
 *
 * Purpose:
 * - Define the handler pipeline for prompt read-by-business-key:
 *   GET /api/prompt/v1/prompt/read/:language/:version/:promptKey
 *
 * Flow:
 *   1) SeedFilterHandler (seed.filter)
 *        - Reads language/version/promptKey from ctx (seeded by controller).
 *        - Seeds ctx["bag.query.dtoCtor"] + ctx["bag.query.filter"] for the next db step.
 *   2) DbReadOneByFilterHandler
 *        - Uses ctx["bag.query.dtoCtor"] + ctx["bag.query.filter"]
 *          to read exactly one record into ctx["bag"] (DtoBag<PromptDto>).
 *   3) DbEnsureUndefinedPlaceholderHandler
 *        - If ctx["bag"] is empty (prompt missing), fire-and-forget a placeholder insert:
 *            template="" and undefined=true
 *          so Ops can query undefined prompts via indexed field.
 *        - Does not change response behavior: caller still receives empty items[].
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";

import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";
import { DbEnsureUndefinedPlaceholderHandler } from "./db.ensureUndefinedPlaceholder";
import { SeedFilterHandler } from "./seed.filter";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerJsonBase
): HandlerBase[] {
  return [
    new SeedFilterHandler(ctx, controller),
    new DbReadOneByFilterHandler(ctx, controller),
    new DbEnsureUndefinedPlaceholderHandler(ctx, controller),
  ];
}
