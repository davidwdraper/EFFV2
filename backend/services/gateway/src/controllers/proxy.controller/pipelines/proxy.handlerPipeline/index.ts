// backend/services/gateway/src/controllers/proxy.controller/pipelines/gateway.proxy.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 *
 * Purpose:
 * - Define the ordered handler steps for the gateway proxy.
 * - For now, a single handler that performs the S2S hop via SvcClient.callRaw().
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { GatewayProxyS2sHandler } from "./gatewayProxyS2s.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // No additional seeding here; controller already set all proxy.* keys.
  return [new GatewayProxyS2sHandler(ctx, controller)];
}
