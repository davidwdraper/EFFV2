// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/index.ts
/**
 * Docs:
 * - SOP: per-pipeline folders; handlers under ./handlers
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version@level)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Read root env followed by merging service's env.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import { DbReadRootHandler } from "./db.readRoot";
import { DbReadHandler } from "./db.read";
import { CodeMergeHandler } from "./code.merge";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerJsonBase
): Array<DbReadRootHandler | DbReadHandler | CodeMergeHandler> {
  return [
    new DbReadRootHandler(ctx, controller),
    new DbReadHandler(ctx, controller),
    new CodeMergeHandler(ctx, controller),
  ];
}
