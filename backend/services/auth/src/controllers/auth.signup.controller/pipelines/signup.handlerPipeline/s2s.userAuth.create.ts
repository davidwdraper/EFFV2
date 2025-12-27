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
 *   • ctx["signup.hash"]
 *   • ctx["signup.hashAlgo"]
 *   • ctx["signup.hashParamsJson"]
 *   • ctx["signup.passwordCreatedAt"]
 * - Call the `user-auth` worker's `create` operation via SvcClient.call().
 *
 * Invariants:
 * - Auth MOS does not write directly to DB; all persistence is via the
 *   `user-auth` worker.
 * - DTO type `user-auth` MUST be registered in the DTO registry.
 * - This handler NEVER calls ctx.set("bag", ...); the edge response remains
 *   the UserDto bag seeded earlier in the pipeline.
 * - Handlers do not reach for app/process/env: they use `this.rt` and request caps.
 * - No silent fallbacks: missing required signup keys hard-fail with ops guidance.
 * - On failure, sets handlerStatus="error" and a Problem+JSON payload via
 *   the standard NvHandlerError on ctx["error"].
 * - Additionally, stamps ctx["signup.userAuthCreateStatus"] with
 *   { ok: true } on success and { ok: false, code, message } on failure.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserAuthDto } from "@nv/shared/dto/user-auth.dto";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

type UserAuthBag = DtoBag<UserAuthDto>;

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

export class S2sUserAuthCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
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

    this.log.debug(
      { event: "execute_enter", handler: this.constructor.name, requestId },
      "auth.signup.callUserAuthCreate: enter handler"
    );

    try {
      // ── Required signup fields ─────────────────────────────────────────────
      const userId = this.safeCtxGet<string>("signup.userId");
      const hash = this.safeCtxGet<string>("signup.hash");
      const hashAlgo = this.safeCtxGet<string>("signup.hashAlgo");
      const hashParamsJson = this.safeCtxGet<string>("signup.hashParamsJson");
      const passwordCreatedAt = this.safeCtxGet<string>(
        "signup.passwordCreatedAt"
      );

      if (!userId || !hash || !hashAlgo || !passwordCreatedAt) {
        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_MISSING_AUTH_FIELDS",
          message:
            "Missing one or more required keys: signup.userId, signup.hash, signup.hashAlgo, signup.passwordCreatedAt.",
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_missing_auth_fields",
          detail:
            "Auth signup expected ctx['signup.userId'], ctx['signup.hash'], ctx['signup.hashAlgo'], and ctx['signup.passwordCreatedAt'] " +
            "to be populated before calling user-auth.create. Dev: ensure upstream handlers seed these values; do not add time fallbacks here.",
          stage: "inputs.authFields",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [
            {
              hasUserId: !!userId,
              hasHash: !!hash,
              hasHashAlgo: !!hashAlgo,
              hasPasswordCreatedAt: !!passwordCreatedAt,
            },
          ],
          logMessage:
            "auth.signup.callUserAuthCreate: required signup auth fields missing.",
          logLevel: "error",
        });
        return;
      }

      // ── DTO creation via registry (HandlerBase already exposes this.registry)
      const reg = this.registry as any;

      const dtoTypeKey = "user-auth";
      const hasDtoType =
        typeof reg.has === "function" ? reg.has(dtoTypeKey) : true;

      if (!hasDtoType) {
        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_USER_AUTH_DTO_UNREGISTERED",
          message: "DTO type 'user-auth' not registered in the DTO registry.",
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_user_auth_dto_unregistered",
          detail:
            "DTO type 'user-auth' is not registered in the DTO registry. " +
            "Dev: register UserAuthDto under dtoType='user-auth' in the service registry.",
          stage: "config.registry.dtoType",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ dtoTypeKey, hasDtoType }],
          logMessage:
            "auth.signup.callUserAuthCreate: 'user-auth' dtoType not registered.",
          logLevel: "error",
        });
        return;
      }

      if (typeof reg.newUserAuthDto !== "function") {
        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_NEW_USER_AUTH_DTO_UNAVAILABLE",
          message: "DTO registry does not expose newUserAuthDto().",
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_new_user_auth_dto_unavailable",
          detail:
            "DTO registry does not expose newUserAuthDto(). " +
            "Dev: add a typed factory newUserAuthDto() so MOS pipelines can create UserAuthDto from in-memory data.",
          stage: "config.registry.factory",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ hasNewUserAuthDto: false }],
          logMessage:
            "auth.signup.callUserAuthCreate: newUserAuthDto() factory missing.",
          logLevel: "error",
        });
        return;
      }

      let userAuthDto: UserAuthDto;
      try {
        userAuthDto = reg.newUserAuthDto() as UserAuthDto;
        (userAuthDto as any).setUserId(userId);
        (userAuthDto as any).setHash(hash);
        (userAuthDto as any).setHashAlgo(hashAlgo);
        (userAuthDto as any).setHashParamsJson(hashParamsJson ?? undefined);
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
            "auth.signup.callUserAuthCreate: UserAuthDto construction failed.",
          logLevel: "error",
        });
        return;
      }

      const bag: UserAuthBag = new DtoBag<UserAuthDto>([userAuthDto]);

      // ── Runtime: env + svcClient capability (canonical key) ────────────────
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
            "auth.signup.callUserAuthCreate: empty env label from rt.getEnv().",
          logLevel: "error",
        });
        return;
      }

      const svcClient = this.rt.tryCap<SvcClient>("s2s.svcClient");

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
            "auth.signup.callUserAuthCreate: missing rt cap s2s.svcClient.",
          logLevel: "error",
        });
        return;
      }

      this.log.debug(
        {
          event: "svcclient_call_start",
          requestId,
          env,
          slug: "user-auth",
          op: "create",
        },
        "auth.signup.callUserAuthCreate: calling user-auth.create via SvcClient"
      );

      // ── External S2S call to user-auth worker ──────────────────────────────
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

        this.log.info(
          {
            event: "svcclient_call_ok",
            requestId,
            env,
            slug: "user-auth",
            op: "create",
          },
          "auth.signup.callUserAuthCreate: user-auth.create succeeded"
        );

        this.ctx.set("handlerStatus", "ok");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err ?? "Unknown error");

        this.ctx.set("signup.userAuthCreateStatus", {
          ok: false,
          code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
          message,
        });

        this.failWithError({
          httpStatus: 502,
          title: "auth_signup_user_auth_create_failed",
          detail:
            "Auth signup failed while calling the user-auth service create endpoint. " +
            "Ops: check user-auth health, svcconfig routing for slug='user-auth', and Mongo connectivity.",
          stage: "s2s.userAuthCreate",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ env, slug: "user-auth", op: "create" }],
          rawError: err,
          logMessage:
            "auth.signup.callUserAuthCreate: user-auth.create S2S call failed.",
          logLevel: "error",
        });
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_auth_handler_failure",
        detail:
          "Unhandled exception while orchestrating auth signup user-auth.create call. Ops: inspect logs for requestId and stack frame.",
        stage: "execute.unhandled",
        requestId,
        origin: { file: __filename, method: "execute" },
        rawError: err,
        logMessage:
          "auth.signup.callUserAuthCreate: unhandled exception in handler.",
        logLevel: "error",
      });
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.constructor.name,
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "auth.signup.callUserAuthCreate: exit handler"
    );
  }
}
