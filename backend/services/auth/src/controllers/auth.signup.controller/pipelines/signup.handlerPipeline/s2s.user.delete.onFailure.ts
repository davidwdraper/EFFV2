// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.delete.onFailure.ts
/**
 * Docs:
 * - SOP: DTO-first persistence via worker services.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose (single concern):
 * - Compensating transaction for signup: if user.create succeeded but
 *   user-auth.create failed, delete the newly created user record so the
 *   system does not retain an orphan User without credentials.
 *
 * Invariants:
 * - Auth remains a MOS (no direct DB writes).
 * - This handler never mutates ctx["bag"]; it only calls the user service.
 * - This handler relies on upstream handlers to set:
 *     ctx["signup.userCreateStatus"]      (S2sUserCreateHandler)
 *     ctx["signup.userAuthCreateStatus"]  (S2sUserAuthCreateHandler)
 *
 * Behavior:
 * - If userCreateStatus.ok !== true → no-op (nothing to roll back).
 * - If pipeline is not in an error state → no-op (nothing to compensate).
 * - If userAuthCreateStatus.ok === true → no-op (no auth failure).
 * - Else:
 *   - Try to delete user via SvcClient.call() using signup.userId.
 *   - Log loudly on success/failure.
 *   - Ensure handlerStatus === "error" and set a Problem+JSON response that
 *     reflects both the auth failure and the rollback result.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

export class S2sUserDeleteOnFailureHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Compensating transaction: delete the created User when user-auth.create fails during signup.";
  }

  /**
   * Special run() override:
   * - This handler is *allowed* to run even when prior handlers failed.
   * - We still rely on execute() gates to decide whether to actually attempt
   *   rollback (userCreateStatus, userAuthCreateStatus, signup.userId, etc).
   */
  public override async run(): Promise<void> {
    const status = this.safeCtxGet<number>("status");
    const handlerStatus = this.safeCtxGet<string>("handlerStatus");
    const priorFailure =
      (typeof status === "number" && status >= 400) ||
      handlerStatus === "error";

    // If no prior failure, just use the normal HandlerBase behavior.
    if (!priorFailure) {
      return super.run();
    }

    // Otherwise, we intentionally *bypass* the short-circuit to attempt a
    // compensating transaction.
    this.log.pipeline(
      {
        event: "execute_start",
        handler: this.constructor.name,
        status,
        handlerStatus,
        priorFailure,
        overrideGate: true,
      },
      "S2sUserDeleteOnFailureHandler.run: enter (ignoring prior-failure gate)"
    );

    try {
      await this.execute();
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_rollback_handler_failure",
        detail:
          "Unhandled exception while attempting user.delete rollback after user-auth.create failure.",
        stage: "rollback.handler_unhandled",
        rawError: err,
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: unhandled exception in rollback handler",
      });
    }

    this.log.pipeline(
      {
        event: "execute_end",
        handler: this.constructor.name,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "error",
        status: this.safeCtxGet<number>("status") ?? 500,
      },
      "S2sUserDeleteOnFailureHandler.run: exit"
    );
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const userCreateStatus = this.safeCtxGet<UserCreateStatus>(
      "signup.userCreateStatus"
    );
    const userAuthCreateStatus = this.safeCtxGet<UserAuthCreateStatus>(
      "signup.userAuthCreateStatus"
    );
    const signupUserId = this.safeCtxGet<string>("signup.userId");

    // --- Gate 1: nothing to roll back if user was never created ----------------
    if (!userCreateStatus || userCreateStatus.ok !== true) {
      this.log.debug(
        {
          event: "rollback_skip_user_not_created",
          requestId,
          hasUserCreateStatus: !!userCreateStatus,
          userCreateOk: userCreateStatus?.ok ?? null,
        },
        "auth.signup.rollbackUserOnAuthCreateFailure: userCreateStatus not successful — no rollback"
      );
      return;
    }

    // --- Gate 2: if userAuthCreateStatus is explicitly ok, do NOT rollback -----
    if (userAuthCreateStatus && userAuthCreateStatus.ok === true) {
      this.log.debug(
        {
          event: "rollback_skip_auth_ok",
          requestId,
        },
        "auth.signup.rollbackUserOnAuthCreateFailure: userAuthCreateStatus.ok === true — no rollback"
      );
      return;
    }

    // At this point the only reasonable interpretation is:
    // - user.create succeeded,
    // - user-auth.create failed or did not complete.
    if (!signupUserId || signupUserId.trim().length === 0) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_rollback_user_missing_id",
        detail:
          "Auth signup detected a downstream failure after user.create succeeded, " +
          "but ctx['signup.userId'] was missing or empty. Ops: the user record may exist without " +
          "credentials; inspect the user service for orphaned records and correct manually.",
        stage: "rollback.user_id_missing",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasSignupUserId: !!signupUserId,
          },
        ],
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: missing signup.userId; cannot safely rollback user",
        logLevel: "error",
      });
      return;
    }

    // We stay DTO-only: reuse the MOS DtoBag<UserDto> from ctx["bag"].
    const userBag = this.safeCtxGet<UserBag>("bag");

    if (!userBag) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_rollback_user_bag_missing",
        detail:
          "Auth signup attempted to rollback a previously created user after auth failure, " +
          "but ctx['bag'] did not contain the expected DtoBag<UserDto>. " +
          "Ops: the user record may exist without credentials; inspect the user service for " +
          "orphaned records and correct manually.",
        stage: "rollback.user_bag_missing",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasUserBag: !!userBag,
            userId: signupUserId,
          },
        ],
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: ctx['bag'] missing; cannot construct DtoBag for user.delete",
        logLevel: "error",
      });
      return;
    }

    // Get AppBase and SvcClient.
    const controller = this.controller as ControllerBase;
    const app = controller.getApp?.() as
      | {
          getEnvLabel?: () => string;
          getSvcClient?: () => unknown;
        }
      | undefined;

    if (!app || typeof app.getEnvLabel !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_rollback_env_unavailable",
        detail:
          "Auth signup attempted to rollback a previously created user after auth failure, " +
          "but could not resolve the environment label from AppBase. " +
          "Ops: ensure AuthApp extends AppBase and envBootstrap/env-service are configured.",
        stage: "rollback.env_unavailable",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasApp: !!app,
            hasGetEnvLabel: !!app && typeof app.getEnvLabel === "function",
          },
        ],
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: AppBase.getEnvLabel() unavailable during rollback",
        logLevel: "error",
      });
      return;
    }

    const env = app.getEnvLabel();
    if (!env) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_rollback_env_empty",
        detail:
          "Auth signup attempted to rollback a previously created user after auth failure, " +
          "but AppBase.getEnvLabel() returned an empty environment. " +
          "Ops: verify env-service configuration for this service.",
        stage: "rollback.env_empty",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            env: env ?? null,
          },
        ],
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: AppBase.getEnvLabel() returned empty env",
        logLevel: "error",
      });
      return;
    }

    if (typeof app.getSvcClient !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_rollback_svcclient_unavailable",
        detail:
          "Auth signup attempted to rollback a previously created user after auth failure, " +
          "but could not obtain SvcClient from the application rails. " +
          "Dev: ensure AppBase wiring exposes getSvcClient() for MOS-style handlers.",
        stage: "rollback.svcclient_unavailable",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasGetSvcClient: !!app && typeof app.getSvcClient === "function",
          },
        ],
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: AppBase.getSvcClient() unavailable during rollback",
        logLevel: "error",
      });
      return;
    }

    const svcClient = app.getSvcClient() as {
      call: <TBag>(opts: {
        env: string;
        slug: string;
        version: number;
        dtoType: string;
        op: string;
        method: string;
        bag?: TBag;
        id?: string;
        requestId?: string;
      }) => Promise<TBag | void>;
    };

    this.log.info(
      {
        event: "rollback_begin",
        requestId,
        env,
        userId: signupUserId,
      },
      "auth.signup.rollbackUserOnAuthCreateFailure: attempting compensating user.delete"
    );

    try {
      // DTO-only rails: pass a DtoBag<UserDto> plus id for the delete.
      const _ignored = await svcClient.call<UserBag>({
        env,
        slug: "user",
        version: 1,
        dtoType: "user",
        op: "delete",
        method: "DELETE",
        id: signupUserId,
        bag: userBag,
        requestId,
      });
      void _ignored;

      this.log.info(
        {
          event: "rollback_ok",
          requestId,
          env,
          userId: signupUserId,
        },
        "auth.signup.rollbackUserOnAuthCreateFailure: user.delete rollback succeeded"
      );

      this.ctx.set("signup.userRolledBack", true);

      // Keep handlerStatus="error" to reflect that signup as a whole failed,
      // but clarify that the user record was rolled back.
      this.failWithError({
        httpStatus: 502,
        title: "auth_signup_userauth_failed_user_rolled_back",
        detail:
          "Auth signup failed while creating user-auth credentials, but the previously " +
          "created user record was rolled back via user.delete. " +
          "Ops: inspect the user-auth service for errors and confirm that no orphaned auth " +
          "records exist for this userId.",
        stage: "rollback.user_delete_ok",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            env,
            userId: signupUserId,
            userRolledBack: true,
          },
        ],
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: auth failure + successful user rollback",
        logLevel: "error",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      this.ctx.set("signup.userRolledBack", false);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_userauth_failed_user_rollback_failed",
        detail:
          "Auth signup failed while creating user-auth credentials, and an attempt to " +
          "rollback the previously created user record via user.delete also failed. " +
          "Ops: the system may now contain a User without credentials; inspect the user and " +
          "user-auth services for inconsistencies and correct manually. Check service logs " +
          "for the underlying rollback error and KMS/JWT/DB connectivity.",
        stage: "rollback.user_delete_failed",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            env,
            userId: signupUserId,
            userRolledBack: false,
          },
        ],
        rawError: err,
        logMessage:
          "auth.signup.rollbackUserOnAuthCreateFailure: user.delete rollback FAILED",
        logLevel: "error",
      });

      this.log.error(
        {
          event: "rollback_error",
          requestId,
          env,
          userId: signupUserId,
          error: message,
        },
        "auth.signup.rollbackUserOnAuthCreateFailure: user.delete rollback FAILED (see failWithError details)"
      );
    }
  }
}
