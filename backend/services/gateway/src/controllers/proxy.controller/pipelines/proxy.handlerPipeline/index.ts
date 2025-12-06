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
import type { GatewayProxyController } from "../../proxy.controller";

import { CodeNormalizeProxyHeadersHandler } from "./code.normalizeProxyHeaders";
import { S2sProxyHandler } from "./s2s.proxy";

export function getSteps(
  ctx: HandlerContext,
  controller: GatewayProxyController
) {
  // No additional seeding here; controller already set all proxy.* keys.
  return [
    new CodeNormalizeProxyHeadersHandler(ctx, controller),
    new S2sProxyHandler(ctx, controller),
  ];
}
