// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/h_seed.rollback.deleteUser.onAuthFailure.ts
/**
 * Docs:
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Pipeline helper that seeds rollback config for the shared
 *   S2sDeleteOnFailureHandler based on auth-signup MOS statuses.
 *
 * Inputs (from ctx, seeded by prior handlers):
 * - ctx["signup.userCreateStatus"]
 * - ctx["signup.userAuthCreateStatus"]
 * - ctx["signup.userId"]
 * - ctx["bag"]
 *
 * Outputs (for S2sDeleteOnFailureHandler contract):
 * - ctx["rollback.whenKey"] / ["rollback.whenEquals"] + gate value
 * - ctx["rollback.slug"], ["rollback.version"], ["rollback.dtoType"], ["rollback.op"], ["rollback.method"]
 * - ctx["rollback.idKey"], ["rollback.bagKey"]
 *
 * Invariants:
 * - This is orchestration glue, not business logic.
 * - It must not call S2S itself; it only seeds ctx.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

export class HSeedRollbackDeleteUserOnAuthFailure extends HandlerBase {
  public constructor(
    ctx: HandlerContext,
    controller: ControllerBase,
    private readonly opts: { slug: string; version: number; dtoType: string }
  ) {
    super(ctx, controller);
  }

  protected override handlerName(): string {
    return "h_seed.rollback.deleteUser.onAuthFailure";
  }

  protected handlerPurpose(): string {
    return "Pipeline helper: seed rollback config+gate for deleting user when user-auth.create fails after user.create succeeds.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const userCreateStatus = this.ctx.get<UserCreateStatus>(
      "signup.userCreateStatus"
    );
    const userAuthCreateStatus = this.ctx.get<UserAuthCreateStatus>(
      "signup.userAuthCreateStatus"
    );

    const userCreated = !!userCreateStatus && userCreateStatus.ok === true;
    const authFailed =
      !!userAuthCreateStatus && (userAuthCreateStatus as any).ok === false;

    const shouldRollback = userCreated && authFailed;

    // Gate key/value used by shared rollback handler.
    const gateKey = "rollback.shouldRun";
    this.ctx.set(gateKey, shouldRollback);

    this.ctx.set("rollback.whenKey", gateKey);
    this.ctx.set("rollback.whenEquals", true);

    this.ctx.set("rollback.slug", this.opts.slug);
    this.ctx.set("rollback.version", this.opts.version);
    this.ctx.set("rollback.dtoType", this.opts.dtoType);
    this.ctx.set("rollback.op", "delete");
    this.ctx.set("rollback.method", "DELETE");

    this.ctx.set("rollback.idKey", "signup.userId");
    this.ctx.set("rollback.bagKey", "bag");

    this.ctx.set("handlerStatus", "ok");

    // Optional trace (debug-level, no policy)
    this.log.debug(
      {
        event: "rollback_seeded",
        requestId,
        shouldRollback,
        slug: this.opts.slug,
        version: this.opts.version,
      },
      "h_seed.rollback.deleteUser.onAuthFailure: seeded rollback config"
    );
  }
}
