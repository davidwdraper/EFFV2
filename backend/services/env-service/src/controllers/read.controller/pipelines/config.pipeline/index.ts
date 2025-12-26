// backend/services/env-service/src/controllers/read.controller/pipelines/config.pipeline/index.ts
/**
 * Docs:
 * - SOP: per-pipeline folders; handlers under ./handlers
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0044 (EnvServiceDto — one doc per env@slug@version)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="_id")
 *
 * Purpose:
 * - /config pipeline:
 *   0) seed mongo override for this pipeline (env-service config DB is infra)
 *   1) read service-root config
 *   2) read service-local config
 *   3) merge vars (service-local overlays root)
 * - Output is ALWAYS an effective singleton bag at ctx["bag"].
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { DbReadOneByFilterHandler } from "@nv/shared/http/handlers/db.readOne.byFilter";

import { SeedMongoConfigHandler } from "./seed.mongoConfig";
import { SeedFilter1Handler } from "./seed.filter1";
import { SeedFilter2Handler } from "./seed.filter2";
import { CodeMergeVarsHandler } from "./code.mergeVars";

export function getSteps(
  ctx: HandlerContext,
  controller: ControllerJsonBase
): HandlerBase[] {
  return [
    // Seed Mongo config override (so db.readOne.byFilter can read env-service’s config DB
    // before SvcRuntime vars are fully available for env-service itself).
    new SeedMongoConfigHandler(ctx, controller),

    // Seed filter for service-root (writes bag to ctx["env.config.root.bag"])
    new SeedFilter1Handler(ctx, controller),
    new DbReadOneByFilterHandler(ctx, controller),

    // Seed filter for requested service slug (writes bag to ctx["env.config.service.bag"])
    new SeedFilter2Handler(ctx, controller),
    new DbReadOneByFilterHandler(ctx, controller),

    // Merge vars: service overlays root; writes effective singleton bag to ctx["bag"]
    new CodeMergeVarsHandler(ctx, controller),
  ];
}
