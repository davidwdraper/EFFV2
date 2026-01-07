// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.userAuth.create.ts
/**
 * Docs:
 * - SOP: DTO-first persistence via worker services.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose:
 * - Construct a DtoBag<UserAuthDto> for the auth storage worker using:
 *   • ctx["signup.userId"]
 *   • ctx["signup.passwordHash"]
 *   • ctx["signup.passwordAlgo"]
 *   • ctx["signup.passwordHashParamsJson"]
 *   • ctx["signup.passwordCreatedAt"]
 * - Call the `user-auth` worker's `create` operation via SvcClient.call().
 *
 * Invariants:
 * - Auth MOS does not write directly to DB; all persistence is via the
 *   `user-auth` worker.
 * - This handler NEVER calls ctx.set("bag", ...); the edge response remains
 *   the UserDto bag seeded earlier in the pipeline.
 * - No silent fallbacks: missing required signup keys hard-fail with ops guidance.
 *
 * Rail semantics (IMPORTANT):
 * - If user-auth.create fails, this handler MUST NOT hard-fail the pipeline.
 * - Instead it sets:
 *     ctx["signup.rollbackUserRequired"] = true
 *     ctx["signup.userAuthCreateStatus"] = { ok:false, ... }
 *   and keeps handlerStatus="ok" so the pipeline can proceed to the rollback step.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserAuthDto } from "@nv/shared/dto/user-auth.dto";
import { UserAuthDtoRegistry } from "@nv/shared/dto/registry/user-auth.dtoRegistry";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

type UserAuthBag = DtoBag<UserAuthDto>;

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

export class S2sUserAuthCreateHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Build a UserAuthDto bag from signup context and call the user-auth worker create operation via SvcClient.";
  }

  protected handlerName(): string {
    return "s2s.userAuth.create";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    // Default: rollback not required unless we explicitly set it on failure.
    this.ctx.set("signup.rollbackUserRequired", false);

    // ── Required signup fields ──
    const userId = this.safeCtxGet<string>("signup.userId");
    const passwordHash = this.safeCtxGet<string>("signup.passwordHash");
    const passwordAlgo = this.safeCtxGet<string>("signup.passwordAlgo");
    const passwordHashParamsJson = this.safeCtxGet<string>(
      "signup.passwordHashParamsJson"
    );
    const passwordCreatedAt = this.safeCtxGet<string>(
      "signup.passwordCreatedAt"
    );

    if (!userId || !passwordHash || !passwordAlgo || !passwordCreatedAt) {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_MISSING_AUTH_FIELDS",
        message:
          "Missing one or more required keys: signup.userId, signup.passwordHash, signup.passwordAlgo, signup.passwordCreatedAt.",
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      // Missing inputs is a DEV bug: hard fail immediately (no rollback step).
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_missing_auth_fields",
        detail:
          "Auth signup expected ctx['signup.userId'], ctx['signup.passwordHash'], ctx['signup.passwordAlgo'], and ctx['signup.passwordCreatedAt'] " +
          "to be populated before calling user-auth.create. Dev: ensure CodePasswordHashHandler ran and stored these values. No fallbacks here.",
        stage: "inputs.authFields",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            hasUserId: !!userId,
            hasPasswordHash: !!passwordHash,
            hasPasswordAlgo: !!passwordAlgo,
            hasPasswordCreatedAt: !!passwordCreatedAt,
          },
        ],
        logMessage:
          "auth.signup.s2s.userAuth.create: required signup auth fields missing.",
        logLevel: "error",
      });
      return;
    }

    // ── Mint DTO via shared minting registry ──
    const userAuthRegistry = new UserAuthDtoRegistry();

    let userAuthDto: UserAuthDto;
    try {
      userAuthDto = userAuthRegistry.newUserAuthDto();

      (userAuthDto as any).setUserId(userId);
      (userAuthDto as any).setHash(passwordHash);
      (userAuthDto as any).setHashAlgo(passwordAlgo);
      (userAuthDto as any).setHashParamsJson(
        passwordHashParamsJson ?? undefined
      );
      (userAuthDto as any).setFailedAttemptCount(0);
      (userAuthDto as any).setPasswordCreatedAt(passwordCreatedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? "");

      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_USER_AUTH_DTO_INVALID",
        message,
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      // DTO build failure is also a DEV bug: hard fail (no rollback step).
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_auth_dto_invalid",
        detail:
          "Auth signup failed while constructing UserAuthDto from in-memory data. " +
          "Dev: verify setter validations and upstream pipeline values.",
        stage: "dto.build",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          { userIdPresent: true, hashPresent: true, hashAlgoPresent: true },
        ],
        rawError: err,
        logMessage:
          "auth.signup.s2s.userAuth.create: UserAuthDto construction failed.",
        logLevel: "error",
      });
      return;
    }

    const bag: UserAuthBag = new DtoBag<UserAuthDto>([userAuthDto]);

    // ── Runtime: env + svcClient capability ──
    const env = (this.rt.getEnv() ?? "").trim();
    if (!env) {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_ENV_EMPTY",
        message: "rt.getEnv() returned an empty env label.",
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_env_empty",
        detail:
          "Auth signup resolved an empty environment label from SvcRuntime. " +
          "Ops: verify envBootstrap/env-service configuration for this service.",
        stage: "config.rt.env.empty",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ env }],
        logMessage:
          "auth.signup.s2s.userAuth.create: empty env label from rt.getEnv().",
        logLevel: "error",
      });
      return;
    }

    let svcClient: SvcClient | undefined;
    try {
      svcClient = this.rt.tryCap<SvcClient>("s2s.svcClient");
    } catch {
      svcClient = undefined;
    }

    if (!svcClient || typeof (svcClient as any).call !== "function") {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_SVCCLIENT_CAP_MISSING",
        message: 'SvcRuntime capability "s2s.svcClient" was not available.',
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_svcclient_cap_missing",
        detail:
          'Auth signup requires SvcRuntime capability "s2s.svcClient" to call the user-auth worker. ' +
          "Dev/Ops: ensure AppBase wires the cap factory under the canonical key.",
        stage: "config.rt.cap.s2s.svcClient",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasSvcClient: !!svcClient }],
        logMessage:
          "auth.signup.s2s.userAuth.create: missing rt cap s2s.svcClient.",
        logLevel: "error",
      });
      return;
    }

    // ── External S2S call to user-auth worker ──
    try {
      const _wire = await svcClient.call({
        env,
        slug: "user-auth",
        version: 1,
        dtoType: "user-auth",
        op: "create",
        method: "PUT",
        bag,
        requestId,
      });
      void _wire;

      this.ctx.set("signup.userAuthCreateStatus", { ok: true });
      this.ctx.set("signup.rollbackUserRequired", false);
      this.ctx.set("handlerStatus", "ok");
      return;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");

      // SOFT FAIL:
      // - We must continue so the rollback step can run.
      // - We mark rollback required and keep handlerStatus="ok".
      this.ctx.set("signup.userAuthCreateStatus", {
        ok: false,
        code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
        message,
      });

      this.ctx.set("signup.rollbackUserRequired", true);
      this.ctx.set("handlerStatus", "ok");

      this.log.error(
        { event: "user_auth_create_failed_soft", requestId, env, message },
        "auth.signup.s2s.userAuth.create: user-auth.create FAILED (soft-fail; rollback required)"
      );

      return;
    }
  }
}
