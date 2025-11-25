// backend/services/auth/src/controllers/auth.create.controller/pipelines/auth.create.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "auth" CREATE.
 * - Controller stays thin; this module owns orchestration (order + S2S targets).
 *
 * Flow (no DB in auth service):
 *  1) createAuthDto       → validate wire bag envelope and hydrate AuthDto via Registry.
 *  2) s2sClientCall (stub)→ eventually call User service via SvcClient v3 to create backing user.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/ControllerBase";

import { CreateAuthDtoHandler } from "./createAuthDto.handler";
import { AuthToUserDtoMapperHandler } from "./auth.toUser.mapper.handler";
import { S2sClientCallHandler } from "@nv/shared/http/handlers/s2sClientCall.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // Seed S2S target metadata for this pipeline.
  // For this flow, auth.create → user service v1.
  ctx.set("s2s.slug", "user");
  ctx.set("s2s.version", "v1");
  // Optionally, upstream can set "s2s.env" (e.g., from svcEnv) if needed later.

  return [
    // 1) Validate wire bag envelope + hydrate AuthDto from inbound payload via Registry.
    new CreateAuthDtoHandler(ctx, controller),

    // 2) Map the AuthDto from the wire to a UserDto sent the user service
    new AuthToUserDtoMapperHandler(ctx, controller),

    // 3) Generic S2S hop (stubbed until SvcClient v3 exists).
    new S2sClientCallHandler(ctx, controller),
  ];
}
