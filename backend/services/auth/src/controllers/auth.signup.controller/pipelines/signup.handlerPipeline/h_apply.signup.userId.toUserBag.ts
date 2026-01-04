// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/h_apply.signup.userId.toUserBag.ts
/**
 * Docs:
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0097 (Controller hydrates + type guards; bag exists before pipeline)
 *
 * Purpose:
 * - Pipeline helper step ("h_") that applies ctx["signup.userId"] to the
 *   hydrated singleton UserDto inside ctx["bag"] using dto.setIdOnce().
 *
 * Invariants:
 * - Writes only to ctx (mutates DTO instance only via DTO rails).
 * - No I/O; no S2S; no DB.
 * - Must run after the helper that seeds ctx["signup.userId"].
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { UserDto } from "@nv/shared/dto/user.dto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";

export class HApplySignupUserIdToUserBag extends HandlerBase {
  public constructor(
    ctx: HandlerContext,
    controller: ControllerBase,
    private readonly opts: { userIdKey?: string; bagKey?: string } = {}
  ) {
    super(ctx, controller);
  }

  protected override handlerName(): string {
    return "h_apply.signup.userId.toUserBag";
  }

  protected handlerPurpose(): string {
    return "Pipeline helper: apply ctx['signup.userId'] onto hydrated singleton UserDto in ctx['bag'] via setIdOnce().";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const userIdKey = this.opts.userIdKey ?? "signup.userId";
    const bagKey = this.opts.bagKey ?? "bag";

    const userId = this.ctx.get<string>(userIdKey);
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      this.failWithError({
        httpStatus: 500,
        title: "pipeline_helper_missing_signup_user_id",
        detail:
          `Expected ctx['${userIdKey}'] before applying id to UserDto. ` +
          "Dev: ensure h_seed.signup.userId.fromStepUuid ran first.",
        stage: "helper.apply.userId",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ userIdKey, hasUserId: !!userId }],
        logMessage:
          "h_apply.signup.userId.toUserBag: missing signup.userId; cannot apply id to bag dto",
        logLevel: "error",
      });
      return;
    }

    const bag = this.ctx.get<DtoBag<UserDto>>(bagKey as any);
    if (!bag || typeof (bag as any).getSingleton !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "pipeline_helper_missing_or_invalid_bag",
        detail:
          `Expected ctx['${bagKey}'] to be a DtoBag-like singleton bag before applying user id. ` +
          "Dev: ensure controller hydration ran and seeded ctx['bag'].",
        stage: "helper.bag",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ bagKey, hasBag: !!bag }],
        logMessage:
          "h_apply.signup.userId.toUserBag: missing/invalid ctx bag; cannot apply id",
        logLevel: "error",
      });
      return;
    }

    const dto = (bag as any).getSingleton();
    const hydratedType =
      dto && typeof dto.getType === "function"
        ? String(dto.getType())
        : "unknown";

    if (!(dto instanceof UserDto) || hydratedType !== "user") {
      this.failWithError({
        httpStatus: 400,
        title: "pipeline_helper_dto_type_mismatch",
        detail: `Expected singleton UserDto in ctx['${bagKey}']; got type='${hydratedType}'.`,
        stage: "helper.type_guard",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hydratedType }],
        logMessage:
          "h_apply.signup.userId.toUserBag: dto type mismatch; refusing to apply id",
        logLevel: "warn",
      });
      return;
    }

    dto.setIdOnce(userId.trim());
    this.ctx.set("handlerStatus", "ok");
  }
}
