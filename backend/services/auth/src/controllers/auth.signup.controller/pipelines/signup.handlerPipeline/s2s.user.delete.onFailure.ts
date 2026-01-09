// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.delete.onFailure.ts
/**
 * Docs:
 * - SOP: DTO-first persistence via worker services.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 only) [via baton]
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose (single concern):
 * - Rollback/cleanup delete of the created user record.
 *
 * Canonical ID rule:
 * - Delete MUST use the baton id: ctx["step.uuid"].
 *   That is the id minted in step #1 and applied to dto._id in step #2.
 *
 * Live vs test behavior:
 * - LIVE: Only executes when ctx["signup.rollbackUserRequired"] === true.
 *         On execution, it attempts delete then FAILS the pipeline so
 *         token minting will not run.
 * - TEST: Always attempts cleanup delete using ctx["step.uuid"].
 *         If it cannot delete, the test MUST fail (no false greens).
 *
 * Outputs (ctx):
 * - ctx["signup.userDeleteAttempted"] → boolean
 * - ctx["signup.userDeleteStatus"]    → { ok:true } or { ok:false, code, message }
 * - ctx["signup.userRolledBack"]      → boolean (legacy-friendly flag)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/db.user.dto";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

type UserBag = DtoBag<UserDto>;

type UserDeleteStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

function readRunMode(ctx: any): "live" | "test" {
  const raw = ctx?.get?.("runMode") ?? ctx?.get?.("pipeline.runMode") ?? "live";
  return raw === "test" ? "test" : "live";
}

export class S2sUserDeleteOnFailureHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Rollback/cleanup: delete the created User using ctx['step.uuid'] (baton).";
  }

  protected handlerName(): string {
    return "s2s.user.delete.onFailure";
  }

  /**
   * This is a compensating/cleanup handler.
   * It MUST be allowed to run after the pipeline has entered an error state,
   * and in this design it may also be invoked while the pipeline rail is still ok
   * (soft-fail from step #5).
   */
  protected override canRunAfterError(): boolean {
    return true;
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");
    const runMode = readRunMode(this.ctx as any);

    // One-flag contract from step #5:
    const rollbackRequired =
      this.safeCtxGet<boolean>("signup.rollbackUserRequired") === true;

    // Canonical delete id: baton
    const stepUuid = this.safeCtxGet<string>("step.uuid");

    // Optional bag (some delete endpoints may ignore it; id is the real contract)
    const userBag = this.safeCtxGet<UserBag>("bag") as UserBag | undefined;

    const env = (this.rt.getEnv() ?? "").trim();

    let svcClient: SvcClient | undefined;
    try {
      svcClient = this.rt.tryCap<SvcClient>("s2s.svcClient");
    } catch {
      svcClient = undefined;
    }

    // Defaults
    this.ctx.set("signup.userDeleteAttempted", false);
    this.ctx.set("signup.userRolledBack", false);

    // ───────────────────────────────────────────
    // LIVE: only run if rollbackRequired===true
    // ───────────────────────────────────────────
    if (runMode === "live" && !rollbackRequired) {
      this.ctx.set("handlerStatus", "ok");
      return;
    }

    // ───────────────────────────────────────────
    // Preconditions for delete (LIVE rollback or TEST cleanup)
    // ───────────────────────────────────────────
    if (!stepUuid || stepUuid.trim().length === 0) {
      this.ctx.set("signup.userDeleteStatus", {
        ok: false,
        code: "AUTH_USER_DELETE_STEP_UUID_MISSING",
        message: "Delete required but ctx['step.uuid'] was missing or empty.",
      } satisfies UserDeleteStatus);

      this.failWithError({
        httpStatus: 500,
        title: "auth_user_delete_step_uuid_missing",
        detail:
          "User delete/rollback required but ctx['step.uuid'] was missing/empty. " +
          "Dev: ensure code.mint.uuid runs at rung #1 and writes ctx['step.uuid'], and code.set.dtoId consumes it at rung #2.",
        stage: "delete.preconditions.step_uuid_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasStepUuid: !!stepUuid, runMode, rollbackRequired }],
        logMessage:
          "auth.signup.s2s.user.delete.onFailure: missing step.uuid; cannot delete deterministically.",
        logLevel: "error",
      });
      return;
    }

    if (!env) {
      this.ctx.set("signup.userDeleteStatus", {
        ok: false,
        code: "AUTH_USER_DELETE_ENV_EMPTY",
        message: "Delete required but rt.getEnv() returned empty.",
      } satisfies UserDeleteStatus);

      this.failWithError({
        httpStatus: 500,
        title: "auth_user_delete_env_empty",
        detail:
          "User delete/rollback required but rt.getEnv() returned empty. " +
          "Ops: ensure env-service config is loaded for this service runtime.",
        stage: "delete.preconditions.env_empty",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ env: env ?? null, runMode, rollbackRequired }],
        logMessage:
          "auth.signup.s2s.user.delete.onFailure: rt.getEnv() empty; cannot call user.delete.",
        logLevel: "error",
      });
      return;
    }

    if (!svcClient || typeof (svcClient as any).call !== "function") {
      this.ctx.set("signup.userDeleteStatus", {
        ok: false,
        code: "AUTH_USER_DELETE_SVCCLIENT_MISSING",
        message: 'Delete required but rt cap "s2s.svcClient" was missing.',
      } satisfies UserDeleteStatus);

      this.failWithError({
        httpStatus: 500,
        title: "auth_user_delete_svcclient_missing",
        detail:
          'User delete/rollback required but SvcRuntime capability "s2s.svcClient" was missing. ' +
          "Dev/Ops: wire the canonical cap so rollback/cleanup can run deterministically.",
        stage: "delete.preconditions.cap_missing",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasSvcClient: !!svcClient, runMode, rollbackRequired }],
        logMessage:
          "auth.signup.s2s.user.delete.onFailure: missing s2s.svcClient; cannot delete.",
        logLevel: "error",
      });
      return;
    }

    // ───────────────────────────────────────────
    // Attempt delete (LIVE rollback or TEST cleanup)
    // ───────────────────────────────────────────
    this.ctx.set("signup.userDeleteAttempted", true);

    try {
      await svcClient.call({
        env,
        slug: "user",
        version: 1,
        dtoType: "user",
        op: "delete",
        method: "DELETE",
        id: stepUuid,
        ...(userBag ? { bag: userBag } : {}),
        requestId,
      } as any);

      this.ctx.set("signup.userRolledBack", true);
      this.ctx.set("signup.userDeleteStatus", {
        ok: true,
      } satisfies UserDeleteStatus);

      // TEST: cleanup succeeded → ok
      if (runMode === "test") {
        this.ctx.set("handlerStatus", "ok");
        return;
      }

      // LIVE: rollback succeeded → NOW we hard-fail the pipeline so token minting does not run.
      this.failWithError({
        httpStatus: 502,
        title: "auth_signup_userauth_failed_user_rolled_back",
        detail:
          "Auth signup failed while creating user-auth credentials, but the created user was rolled back via user.delete. " +
          "Ops: inspect user-auth logs; user record should not exist for the baton id.",
        stage: "rollback.user_delete_ok",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ env, rolledBack: true, userId: stepUuid }],
        logMessage:
          "auth.signup.s2s.user.delete.onFailure: rollback delete OK; failing pipeline to prevent token mint.",
        logLevel: "error",
      });
      return;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");

      this.ctx.set("signup.userRolledBack", false);
      this.ctx.set("signup.userDeleteStatus", {
        ok: false,
        code:
          runMode === "test"
            ? "AUTH_TEST_USER_DELETE_FAILED"
            : "AUTH_SIGNUP_ROLLBACK_USER_DELETE_FAILED",
        message,
      } satisfies UserDeleteStatus);

      // TEST must fail (no false greens)
      if (runMode === "test") {
        this.failWithError({
          httpStatus: 500,
          title: "auth_test_user_delete_failed",
          detail:
            "Test cleanup delete attempted but failed. This would leave stray user records and produce false positives. " +
            "Ops: check user service health/routing; Dev: ensure svcClient and env are correctly wired for tests.",
          stage: "test.cleanup.delete_failed",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ env, userId: stepUuid }],
          rawError: err,
          logMessage:
            "auth.test.s2s.user.delete.onFailure: cleanup delete FAILED (test must fail).",
          logLevel: "error",
        });
        return;
      }

      // LIVE rollback failure → fail pipeline loudly
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_userauth_failed_user_rollback_failed",
        detail:
          "Auth signup failed while creating user-auth credentials, and an attempt to rollback the created user via user.delete also failed. " +
          "Ops: system may contain a User without credentials; inspect user and user-auth services and correct manually.",
        stage: "rollback.user_delete_failed",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ env, userId: stepUuid, rolledBack: false }],
        rawError: err,
        logMessage:
          "auth.signup.s2s.user.delete.onFailure: rollback delete FAILED.",
        logLevel: "error",
      });
      return;
    }
  }
}
