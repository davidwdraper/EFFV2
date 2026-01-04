// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/h_seed.signup.userId.fromStepUuid.ts
/**
 * Docs:
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0057 (UUID baton on ctx["step.uuid"])
 * - ADR-0097 (Controller hydration; pipeline starts with ctx["bag"])
 *
 * Purpose:
 * - Pipeline helper step ("h_") that translates the generic UUID baton
 *   ctx["step.uuid"] into the domain key ctx["signup.userId"].
 *
 * Invariants:
 * - This is NOT a business-logic handler; it is orchestration glue.
 * - Writes only to ctx; no I/O; no S2S; no DB.
 * - Must run immediately after CodeMintUuidHandler and before any consumer.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

export class HSeedSignupUserIdFromStepUuid extends HandlerBase {
  public constructor(
    ctx: HandlerContext,
    controller: ControllerBase,
    private readonly opts: { fromKey?: string; toKey?: string } = {}
  ) {
    super(ctx, controller);
  }

  protected override handlerName(): string {
    return "h_seed.signup.userId.fromStepUuid";
  }

  protected handlerPurpose(): string {
    return "Pipeline helper: copy ctx['step.uuid'] baton into ctx['signup.userId'] for downstream MOS handlers.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const fromKey = this.opts.fromKey ?? "step.uuid";
    const toKey = this.opts.toKey ?? "signup.userId";

    const v = this.ctx.get<string>(fromKey);

    if (!v || typeof v !== "string" || v.trim().length === 0) {
      this.failWithError({
        httpStatus: 500,
        title: "pipeline_helper_missing_uuid_baton",
        detail:
          `Expected ctx['${fromKey}'] to be populated by CodeMintUuidHandler before seeding ctx['${toKey}']. ` +
          "Dev: ensure CodeMintUuidHandler runs immediately before this helper.",
        stage: "helper.seed.userId",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ fromKey, toKey, hasFrom: !!v }],
        logMessage:
          "h_seed.signup.userId.fromStepUuid: missing ctx uuid baton; cannot seed signup.userId",
        logLevel: "error",
      });
      return;
    }

    this.ctx.set(toKey, v.trim());
    this.ctx.set("handlerStatus", "ok");
  }
}
