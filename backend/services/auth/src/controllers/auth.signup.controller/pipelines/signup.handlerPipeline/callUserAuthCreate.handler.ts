// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/callUserAuthCreate.handler.ts
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
 * - On success, ctx["bag"] contains the returned DtoBag<UserAuthDto>.
 * - On failure, sets handlerStatus="error" and a Problem+JSON payload.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserAuthDto } from "@nv/shared/dto/user-auth.dto";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

type UserAuthBag = DtoBag<UserAuthDto>;

export class CallUserAuthCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.ctx.get<string>("requestId");

    const userId = this.ctx.get<string | undefined>("signup.userId");
    const hash = this.ctx.get<string | undefined>("signup.hash");
    const hashAlgo = this.ctx.get<string | undefined>("signup.hashAlgo");
    const hashParamsJson = this.ctx.get<string | undefined>(
      "signup.hashParamsJson"
    );
    const passwordCreatedAt =
      this.ctx.get<string | undefined>("signup.passwordCreatedAt") ??
      new Date().toISOString();

    if (!userId || !hash || !hashAlgo) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_missing_auth_fields",
        detail:
          "Auth signup expected ctx['signup.userId'], ctx['signup.hash'], and ctx['signup.hashAlgo'] to be populated before calling user-auth.create. " +
          "Dev: ensure the userId generator and GeneratePasswordHashHandler ran successfully earlier in the pipeline.",
        status: 500,
        code: "AUTH_SIGNUP_MISSING_AUTH_FIELDS",
        requestId,
      });
      return;
    }

    const controller = this.controller;

    // DTO Registry must be present and must expose newUserAuthDto().
    const registryMaybe = (
      controller as unknown as {
        getDtoRegistry?: () => unknown;
      }
    ).getDtoRegistry?.();

    if (!registryMaybe) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_registry_unavailable",
        detail:
          "Auth signup could not access the DTO registry from the controller. " +
          "Dev: ensure AuthApp/AppBase wiring exposes getDtoRegistry() and that controllers pass it through.",
        status: 500,
        code: "AUTH_SIGNUP_REGISTRY_UNAVAILABLE",
        requestId,
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
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_user_auth_dto_unregistered",
        detail:
          "DTO type 'user-auth' is not registered in the DTO registry. " +
          "Dev: register the UserAuthDto under dtoType='user-auth' in the Auth DTO registry and expose newUserAuthDto().",
        status: 500,
        code: "AUTH_SIGNUP_USER_AUTH_DTO_UNREGISTERED",
        requestId,
      });
      return;
    }

    if (typeof registry.newUserAuthDto !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_new_user_auth_dto_unavailable",
        detail:
          "DTO registry does not expose newUserAuthDto(). " +
          "Dev: add a typed factory method newUserAuthDto() to the registry so MOS pipelines can create UserAuthDto instances from in-memory data.",
        status: 500,
        code: "AUTH_SIGNUP_NEW_USER_AUTH_DTO_UNAVAILABLE",
        requestId,
      });
      return;
    }

    // --- DTO creation via Registry + setters (no fromJson, no JSON reshaping) ----
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
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_user_auth_dto_invalid",
        detail:
          "Auth signup failed while constructing UserAuthDto from in-memory data. " +
          "Dev: check setter validations for userId/hash/hashAlgo/hashParamsJson/passwordCreatedAt and upstream pipeline values.",
        status: 500,
        code: "AUTH_SIGNUP_USER_AUTH_DTO_INVALID",
        requestId,
        error: message,
      });
      return;
    }

    const bag: UserAuthBag = new DtoBag<UserAuthDto>([userAuthDto]);

    // Get AppBase and SvcClient from the rails.
    const app = controller.getApp() as {
      getEnvLabel?: () => string;
      getSvcClient?: () => unknown;
    };

    if (!app || typeof app.getEnvLabel !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_env_unavailable",
        detail:
          "Auth signup could not resolve the environment label from AppBase. " +
          "Dev/Ops: ensure AuthApp extends AppBase and that getEnvLabel() is exposed correctly.",
        status: 500,
        code: "AUTH_SIGNUP_ENV_UNAVAILABLE",
        requestId,
      });
      return;
    }

    const env = app.getEnvLabel();
    if (!env) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_env_empty",
        detail:
          "Auth signup resolved an empty environment label from AppBase.getEnvLabel(). " +
          "Ops: verify envBootstrap/env-service configuration for this service.",
        status: 500,
        code: "AUTH_SIGNUP_ENV_EMPTY",
        requestId,
      });
      return;
    }

    if (typeof app.getSvcClient !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_svcclient_unavailable",
        detail:
          "Auth signup could not obtain SvcClient from the application rails. " +
          "Dev: ensure AppBase wiring exposes getSvcClient() for MOS-style handlers.",
        status: 500,
        code: "AUTH_SIGNUP_SVCCLIENT_UNAVAILABLE",
        requestId,
      });
      return;
    }

    const svcClient = app.getSvcClient() as {
      call: (opts: {
        env: string;
        slug: string;
        version: number;
        dtoType: string;
        op: string;
        method: string;
        bag: UserAuthBag;
        requestId?: string;
      }) => Promise<UserAuthBag>;
    };

    this.log.debug(
      {
        requestId,
        env,
      },
      "auth.signup.callUserAuthCreate: calling user-auth.create via SvcClient"
    );

    try {
      const returnedBag = await svcClient.call({
        env,
        slug: "user-auth", // auth credential storage worker slug
        version: 1, // worker service major version
        dtoType: "user-auth", // dtoType in URL: /api/user-auth/v1/user-auth/create
        op: "create",
        method: "PUT",
        bag,
        requestId,
      });

      // On success, treat the returned UserAuthDto bag as the canonical view.
      this.ctx.set("bag", returnedBag);

      this.log.info(
        {
          requestId,
          env,
          slug: "user-auth",
          op: "create",
        },
        "auth.signup.callUserAuthCreate: user-auth.create succeeded"
      );

      this.ctx.set("handlerStatus", "success");
    } catch (err) {
      const message = (err as Error)?.message ?? "Unknown error";

      this.log.error(
        {
          requestId,
          env,
          slug: "user-auth",
          op: "create",
          error: message,
        },
        "auth.signup.callUserAuthCreate: user-auth.create failed"
      );

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 502);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_user_auth_create_failed",
        detail:
          "Auth signup failed while calling the user-auth service create endpoint. " +
          "Ops: check user-auth service health, svcconfig routing for slug='user-auth', and Mongo connectivity.",
        status: 502,
        code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
        requestId,
        error: message,
      });
    }
  }
}
