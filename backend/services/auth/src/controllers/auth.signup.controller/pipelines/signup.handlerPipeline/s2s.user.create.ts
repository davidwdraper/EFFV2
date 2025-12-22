// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.create.ts
/**
 * Docs:
 * - SOP: DTO-first persistence via worker services.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
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
 * - On failure, sets handlerStatus="error" via NvHandlerError on ctx["error"].
 * - Additionally, this handler stamps an explicit signup.userCreateStatus flag
 *   on the ctx bus so downstream transactional handlers (rollback, audit, etc.)
 *   can reason about whether the user record was created.
 *
 * Testing:
 * - This handler opts into test-runner by overriding runTest().
 * - The sibling *.test.ts file remains an implementation detail imported here.
 * - If runTest() is removed, test-runner will naturally skip this handler.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { UserDto } from "@nv/shared/dto/user.dto";

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import { S2sUserCreateTest } from "./s2s.user.create.test";

type UserBag = DtoBag<UserDto>;

type UserCreateStatus =
  | {
      ok: true;
      userId?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export class S2sUserCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  /**
   * One-sentence, ops-facing description of what this handler does.
   */
  protected handlerPurpose(): string {
    return "Call the user service create endpoint with the hydrated UserDto bag while leaving ctx['bag'] untouched.";
  }

  protected handlerName(): string {
    return "s2s.user.create";
  }

  public override hasTest(): boolean {
    return true;
  }

  /**
   * Test hook used by the handler-level test harness.
   * Uses the same scenario entrypoint the test-runner relies on.
   */
  public override async runTest(): Promise<HandlerTestResult | undefined> {
    return this.runSingleTest(S2sUserCreateTest);
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    this.log.debug(
      {
        event: "execute_enter",
        handler: this.constructor.name,
        requestId,
      },
      "auth.signup.callUserCreate: enter handler"
    );

    let env: string | undefined;

    try {
      const bag = this.safeCtxGet<UserBag>("bag");

      if (!bag) {
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_MISSING_USER_BAG",
          message: "Ctx['bag'] was empty before user.create.",
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_missing_user_bag",
          detail:
            "Auth signup pipeline expected ctx['bag'] to contain a DtoBag<UserDto> before calling user.create. " +
            "Dev: ensure HydrateUserBagHandler ran and stored the bag under ctx['bag'].",
          stage: "inputs.userBag",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ hasBag: !!bag }],
          logMessage:
            "auth.signup.callUserCreate: ctx['bag'] missing before user.create.",
          logLevel: "error",
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
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_ENV_UNAVAILABLE",
          message: "AuthApp.getEnvLabel() was not available.",
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_env_unavailable",
          detail:
            "Auth signup could not resolve the environment label from AppBase. " +
            "Dev/Ops: ensure AuthApp extends AppBase and that getEnvLabel() is exposed correctly.",
          stage: "config.app.envLabel",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ hasApp: !!app, hasGetEnvLabel: !!app?.getEnvLabel }],
          logMessage:
            "auth.signup.callUserCreate: getEnvLabel() not available on app.",
          logLevel: "error",
        });
        return;
      }

      env = app.getEnvLabel();
      if (!env) {
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_ENV_EMPTY",
          message: "AppBase.getEnvLabel() returned an empty env label.",
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_env_empty",
          detail:
            "Auth signup resolved an empty environment label from AppBase.getEnvLabel(). " +
            "Ops: verify envBootstrap/env-service configuration for this service.",
          stage: "config.app.envLabel.empty",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ env }],
          logMessage:
            "auth.signup.callUserCreate: empty env label from getEnvLabel().",
          logLevel: "error",
        });
        return;
      }

      if (typeof app.getSvcClient !== "function") {
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_SVCCLIENT_UNAVAILABLE",
          message: "AppBase.getSvcClient() was not available.",
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_svcclient_unavailable",
          detail:
            "Auth signup could not obtain SvcClient from the application rails. " +
            "Dev: ensure AppBase wiring exposes getSvcClient() for MOS-style handlers.",
          stage: "config.app.svcClient",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [{ hasGetSvcClient: !!app.getSvcClient }],
          logMessage:
            "auth.signup.callUserCreate: getSvcClient() not available on app.",
          logLevel: "error",
        });
        return;
      }

      // NOTE: SvcClient.call signature is intentionally a bit generic here so it
      // can be reused by the rollback handler for delete operations.
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
        }) => Promise<TBag>;
      };

      const signupUserId = this.safeCtxGet<string>("signup.userId");

      this.log.debug(
        {
          event: "svcclient_call_start",
          requestId,
          env,
          signupUserId,
          slug: "user",
          op: "create",
        },
        "auth.signup.callUserCreate: calling user.create via SvcClient"
      );

      // ---- External S2S call to user worker --------------------------------
      try {
        const returnedBag = await svcClient.call<UserBag>({
          env,
          slug: "user", // target worker service slug
          version: 1, // user service major version
          dtoType: "user", // dtoType in URL: /api/user/v1/user/create
          op: "create",
          method: "PUT",
          bag,
          requestId,
        });

        // HydrateUserBagHandler is the ONLY writer of ctx["bag"].
        // We explicitly do not reassign it here.
        void returnedBag;

        const status: UserCreateStatus = {
          ok: true,
          userId: signupUserId,
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.log.info(
          {
            event: "svcclient_call_ok",
            requestId,
            env,
            slug: "user",
            op: "create",
            userId: signupUserId ?? null,
          },
          "auth.signup.callUserCreate: user.create succeeded"
        );

        this.ctx.set("handlerStatus", "ok");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err ?? "Unknown error");

        let downstreamStatus: number | undefined;
        if (err instanceof Error) {
          const m = err.message.match(/status=(\d{3})/);
          if (m && m[1]) {
            const n = Number(m[1]);
            if (Number.isFinite(n)) {
              downstreamStatus = n;
            }
          }
        }

        const isDuplicate = downstreamStatus === 409;

        const httpStatus = isDuplicate ? 409 : 502;
        const status: UserCreateStatus = {
          ok: false,
          code: isDuplicate
            ? "AUTH_SIGNUP_USER_DUPLICATE"
            : "AUTH_SIGNUP_USER_CREATE_FAILED",
          message,
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.failWithError({
          httpStatus,
          title: isDuplicate
            ? "auth_signup_user_duplicate"
            : "auth_signup_user_create_failed",
          detail: isDuplicate
            ? "Auth signup failed because the user service reported a duplicate user (likely email already in use). Front-end: treat this as a 409 duplicate signup."
            : "Auth signup failed while calling the user service create endpoint. " +
              "Ops: check user service health, svcconfig routing for slug='user', and Mongo connectivity.",
          stage: "s2s.userCreate",
          requestId,
          origin: {
            file: __filename,
            method: "execute",
          },
          issues: [
            {
              env,
              slug: "user",
              op: "create",
              downstreamStatus,
            },
          ],
          rawError: err,
          logMessage: isDuplicate
            ? "auth.signup.callUserCreate: user.create returned duplicate (mapped to 409)."
            : "auth.signup.callUserCreate: user.create S2S call failed.",
          logLevel: isDuplicate ? "warn" : "error",
        });
      }
    } catch (err) {
      // Catch-all for unexpected bugs inside the handler.
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_create_handler_failure",
        detail:
          "Unhandled exception while orchestrating auth signup user.create call. Ops: inspect logs for requestId and stack frame.",
        stage: "execute.unhandled",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        rawError: err,
        logMessage:
          "auth.signup.callUserCreate: unhandled exception in handler.",
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
      "auth.signup.callUserCreate: exit handler"
    );
  }
}
