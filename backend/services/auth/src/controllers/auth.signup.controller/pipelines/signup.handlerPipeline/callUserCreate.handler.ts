// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/callUserCreate.handler.ts
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
 * Purpose:
 * - Use the hydrated DtoBag<UserDto> from ctx["bag"] to call the `user`
 *   service's `create` operation via SvcClient.call().
 * - On success, the existing ctx["bag"] remains the MOS edge view; this handler
 *   MUST NOT reassign ctx["bag"] (hydrate is the sole writer).
 *
 * Invariants:
 * - Auth remains a MOS (no direct DB writes).
 * - This handler NEVER calls ctx.set("bag", ...).
 * - On failure, sets handlerStatus="error" and a Problem+JSON payload.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";

type UserBag = DtoBag<UserDto>;

export class CallUserCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.ctx.get<string>("requestId");
    const bag = this.ctx.get<UserBag | undefined>("bag");

    if (!bag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_missing_user_bag",
        detail:
          "Auth signup pipeline expected ctx['bag'] to contain a DtoBag<UserDto> before calling user.create. " +
          "Dev: ensure HydrateUserBagHandler ran and stored the bag under ctx['bag'].",
        status: 500,
        code: "AUTH_SIGNUP_MISSING_USER_BAG",
        requestId,
      });
      return;
    }

    // Get AppBase and env label from the rails.
    const controller = this.controller;
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
        bag: UserBag;
        requestId?: string;
      }) => Promise<UserBag>;
    };

    this.log.debug(
      {
        requestId,
        env,
      },
      "auth.signup.callUserCreate: calling user.create via SvcClient"
    );

    try {
      // DTO-based path: user service CRUD rails.
      const returnedBag = await svcClient.call({
        env,
        slug: "user", // target worker service slug
        version: 1, // user service major version
        dtoType: "user", // dtoType in URL: /api/user/v1/user/create
        op: "create",
        method: "PUT",
        bag,
        requestId,
      });

      // Immediate fix invariant:
      // - HydrateUserBagHandler is the ONLY writer of ctx["bag"].
      // - This handler must NOT reassign ctx["bag"].
      //
      // If SvcClient.call() mutates the passed-in bag instance, finalize()
      // will already see the persisted view. If it returns a new instance,
      // finalize() will still see the original hydrated view, which is
      // acceptable for MOS v1.
      void returnedBag;

      this.log.info(
        {
          requestId,
          env,
          slug: "user",
          op: "create",
        },
        "auth.signup.callUserCreate: user.create succeeded"
      );

      this.ctx.set("handlerStatus", "success");
    } catch (err) {
      const message = (err as Error)?.message ?? "Unknown error";

      this.log.error(
        {
          requestId,
          env,
          slug: "user",
          op: "create",
          error: message,
        },
        "auth.signup.callUserCreate: user.create failed"
      );

      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 502);
      this.ctx.set("response.body", {
        type: "about:blank",
        title: "auth_signup_user_create_failed",
        detail:
          "Auth signup failed while calling the user service create endpoint. " +
          "Ops: check user service health, svcconfig routing for slug='user', and Mongo connectivity.",
        status: 502,
        code: "AUTH_SIGNUP_USER_CREATE_FAILED",
        requestId,
        error: message,
      });
    }
  }
}
