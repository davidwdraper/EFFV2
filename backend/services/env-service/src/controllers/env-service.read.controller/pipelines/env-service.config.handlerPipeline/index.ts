// backend/services/env-service/src/controllers/env-service.read.controller/pipelines/env-service.config.handlerPipeline/index.ts
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
 * - Define the handler pipeline for:
 *     GET /api/env-service/v1/env-service/config?slug=&version=&env=&level=
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/ControllerBase";
import { EnvServiceConfigGetHandler } from "./handlers/env-service.config.get.handler";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerBase
): EnvServiceConfigGetHandler[] {
  const steps: EnvServiceConfigGetHandler[] = [
    new EnvServiceConfigGetHandler(ctx, controller),
  ];
  return steps;
}
