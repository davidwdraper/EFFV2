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
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
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
 * - Handlers do not reach for app/process/env: they use ctx["rt"] and request caps.
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
import type { SvcClient } from "@nv/shared/s2s/SvcClient";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

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

  protected handlerPurpose(): string {
    return "Call the user service create endpoint with the hydrated UserDto bag while leaving ctx['bag'] untouched.";
  }

  protected handlerName(): string {
    return "s2s.user.create";
  }

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

      // Runtime is the single access door.
      const rt = this.safeCtxGet<SvcRuntime>("rt");
      if (!rt) {
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_RT_UNAVAILABLE",
          message: "Ctx['rt'] was not available.",
        };
        this.ctx.set("signup.userCreateStatus", status);

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
          logMessage: "auth.signup.callUserCreate: ctx['rt'] missing.",
          logLevel: "error",
        });
        return;
      }

      env = (rt.getEnv() ?? "").trim();
      if (!env) {
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_ENV_EMPTY",
          message: "rt.getEnv() returned an empty env label.",
        };
        this.ctx.set("signup.userCreateStatus", status);

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
          logMessage: "auth.signup.callUserCreate: empty env label from rt.",
          logLevel: "error",
        });
        return;
      }

      // Capability: s2s.svcClient (fail-fast if missing)
      const s2sCap = rt.tryCap("s2s") as { svcClient?: SvcClient } | undefined;
      const svcClient = s2sCap?.svcClient;

      if (!svcClient || typeof (svcClient as any).call !== "function") {
        const status: UserCreateStatus = {
          ok: false,
          code: "AUTH_SIGNUP_SVCCLIENT_CAP_MISSING",
          message: 'SvcRuntime capability "s2s.svcClient" was not available.',
        };
        this.ctx.set("signup.userCreateStatus", status);

        this.failWithError({
          httpStatus: 500,
          title: "auth_signup_svcclient_cap_missing",
          detail:
            'Auth signup requires SvcRuntime capability "s2s.svcClient" to call the user worker. ' +
            "Dev/Ops: wire rt caps during envBootstrap/AppBase construction for auth (svcClient must be present).",
          stage: "config.rt.cap.s2s.svcClient",
          requestId,
          origin: { file: __filename, method: "execute" },
          issues: [{ hasS2sCap: !!s2sCap, hasSvcClient: !!svcClient }],
          logMessage:
            "auth.signup.callUserCreate: missing rt cap s2s.svcClient.",
          logLevel: "error",
        });
        return;
      }

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
        // IMPORTANT:
        // - SvcClient.call returns WireBagJson (wire JSON), not a hydrated DtoBag<T>.
        // - This handler does not need the returned payload (hydrate is the bag writer).
        const _wire = await svcClient.call({
          env,
          slug: "user",
          version: 1,
          dtoType: "user",
          op: "create",
          method: "PUT",
          bag,
          requestId,
        });
        void _wire;

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
