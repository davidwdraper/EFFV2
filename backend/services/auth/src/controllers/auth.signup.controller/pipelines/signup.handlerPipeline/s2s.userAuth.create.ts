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
 * - DTO type `user-auth` MUST be registered in the DTO registry, and
 *   created via Registry.newUserAuthDto().
 * - This handler NEVER calls ctx.set("bag", ...); the edge response remains
 *   the UserDto bag seeded by HydrateUserBagHandler.
 * - Handlers do not reach for app/process/env: they use ctx["rt"] and request caps.
 * - On failure, sets handlerStatus="error" and a Problem+JSON payload via
 *   the standard NvHandlerError on ctx["error"].
 * - Additionally, this handler stamps ctx["signup.userAuthCreateStatus"] with
 *   { ok: true } on success and { ok: false, code, message } on failure so
 *   downstream transactional handlers (e.g., rollback) can reason about the
 *   auth side of the signup.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserAuthDto } from "@nv/shared/dto/user-auth.dto";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";
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
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "auth.signup.callUserAuthCreate: enter handler"
    );

    let env: string | undefined;

    try {
      // ---- Required signup fields ------------------------------------------
      const userId = this.safeCtxGet<string>("signup.userId");
      const hash = this.safeCtxGet<string>("signup.hash");
      const hashAlgo = this.safeCtxGet<string>("signup.hashAlgo");
      const hashParamsJson = this.safeCtxGet<string>("signup.hashParamsJson");
      const passwordCreatedAt =
        this.safeCtxGet<string>("signup.passwordCreatedAt") ??
        new Date().toISOString();

      if (!userId || !hash || !hashAlgo) {
        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_MISSING_AUTH_FIELDS",
          message:
            "Missing one or more of signup.userId, signup.hash, signup.hashAlgo.",
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_missing_auth_fields",
          detail:
            "Auth signup expected ctx['signup.userId'], ctx['signup.hash'], and ctx['signup.hashAlgo'] to be populated before calling user-auth.create. " +
            "Dev: ensure the userId generator and GeneratePasswordHashHandler ran successfully earlier in the pipeline.",
          stage: "inputs.authFields",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              hasUserId: !!userId,
              hasHash: !!hash,
              hasHashAlgo: !!hashAlgo,
            },
          ],
          logMessage:
            "auth.signup.callUserAuthCreate: required signup auth fields missing.",
          logLevel: "error",
        });
        return;
      }

      const controller = this.controller;

      // ---- DTO Registry presence -------------------------------------------
      // NOTE: We still use the controller for the registry for now.
      // Next step in this SvcRuntime work: promote registry to an rt capability too.
      const registryMaybe = (
        controller as unknown as {
          getDtoRegistry?: () => unknown;
        }
      ).getDtoRegistry?.();

      if (!registryMaybe) {
        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_REGISTRY_UNAVAILABLE",
          message: "Controller.getDtoRegistry() returned undefined.",
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_registry_unavailable",
          detail:
            "Auth signup could not access the DTO registry from the controller. " +
            "Dev: ensure AuthApp/AppBase wiring exposes getDtoRegistry() and that controllers pass it through.",
          stage: "config.registry",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ hasRegistry: !!registryMaybe }],
          logMessage:
            "auth.signup.callUserAuthCreate: DTO registry unavailable on controller.",
          logLevel: "error",
        });
        return;
      }

      const registry = registryMaybe as {
        newUserAuthDto?: () => UserAuthDto;
        has?: (key: string) => boolean;
      };

      const dtoTypeKey = "user-auth";
      const hasDtoType =
        typeof registry.has === "function" ? registry.has(dtoTypeKey) : true;

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
            "Dev: register the UserAuthDto under dtoType='user-auth' in the Auth DTO registry and expose newUserAuthDto().",
          stage: "config.registry.dtoType",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ dtoTypeKey, hasDtoType }],
          logMessage:
            "auth.signup.callUserAuthCreate: 'user-auth' dtoType not registered.",
          logLevel: "error",
        });
        return;
      }

      if (typeof registry.newUserAuthDto !== "function") {
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
            "Dev: add a typed factory method newUserAuthDto() to the registry so MOS pipelines can create UserAuthDto instances from in-memory data.",
          stage: "config.registry.factory",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ hasNewUserAuthDto: false }],
          logMessage:
            "auth.signup.callUserAuthCreate: newUserAuthDto() factory not available on registry.",
          logLevel: "error",
        });
        return;
      }

      // ---- DTO creation via Registry + setters (no fromJson) ---------------
      let userAuthDto: UserAuthDto;
      try {
        userAuthDto = registry.newUserAuthDto();
        userAuthDto.setUserId(userId);
        userAuthDto.setHash(hash);
        userAuthDto.setHashAlgo(hashAlgo);
        userAuthDto.setHashParamsJson(hashParamsJson ?? undefined);
        userAuthDto.setFailedAttemptCount(0);
        userAuthDto.setPasswordCreatedAt(passwordCreatedAt);
      } catch (err) {
        const message = (err as Error)?.message ?? "Unknown error";

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
            "Dev: check setter validations for userId/hash/hashAlgo/hashParamsJson/passwordCreatedAt and upstream pipeline values.",
          stage: "dto.build",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              userIdPresent: !!userId,
              hashPresent: !!hash,
              hashAlgoPresent: !!hashAlgo,
            },
          ],
          rawError: err,
          logMessage:
            "auth.signup.callUserAuthCreate: UserAuthDto construction failed.",
          logLevel: "error",
        });
        return;
      }

      const bag: UserAuthBag = new DtoBag<UserAuthDto>([userAuthDto]);

      // ---- Runtime: env + svcClient capability -----------------------------
      const rt = this.safeCtxGet<SvcRuntime>("rt");
      if (!rt) {
        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_RT_UNAVAILABLE",
          message: "Ctx['rt'] was not available.",
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_rt_unavailable",
          detail:
            "Auth signup could not obtain SvcRuntime from ctx['rt']. " +
            "Dev: ensure ControllerBase seeds ctx['rt'] for all requests.",
          stage: "config.rt",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ hasRt: !!rt }],
          logMessage: "auth.signup.callUserAuthCreate: ctx['rt'] missing.",
          logLevel: "error",
        });
        return;
      }

      env = (rt.getEnv() ?? "").trim();
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
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ env }],
          logMessage:
            "auth.signup.callUserAuthCreate: empty env label from rt.getEnv().",
          logLevel: "error",
        });
        return;
      }

      // Capability lookup (fail-fast):
      const s2sCap = rt.tryCap("s2s") as { svcClient?: SvcClient } | undefined;

      const svcClient = s2sCap?.svcClient;
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
            "Dev/Ops: wire rt caps during envBootstrap/AppBase construction for auth (svcClient must be present).",
          stage: "config.rt.cap.s2s.svcClient",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              hasS2sCap: !!s2sCap,
              hasSvcClient: !!svcClient,
            },
          ],
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

      // ---- External edge: S2S call to user-auth worker ---------------------
      try {
        // IMPORTANT:
        // - SvcClient.call returns WireBagJson (wire JSON), not DtoBag<UserAuthDto>.
        // - This handler does not need the returned payload.
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

        const status: UserAuthCreateStatus = { ok: true };
        this.ctx.set("signup.userAuthCreateStatus", status);

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
        const message = (err as Error)?.message ?? "Unknown error";

        const status: UserAuthCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
          message,
        };
        this.ctx.set("signup.userAuthCreateStatus", status);

        this.failWithError({
          httpStatus: 502,
          title: "auth_signup_user_auth_create_failed",
          detail:
            "Auth signup failed while calling the user-auth service create endpoint. " +
            "Ops: check user-auth service health, svcconfig routing for slug='user-auth', and Mongo connectivity.",
          stage: "s2s.userAuthCreate",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
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
        origin: {
          file: __filename,
          method: "execute",
        },
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
