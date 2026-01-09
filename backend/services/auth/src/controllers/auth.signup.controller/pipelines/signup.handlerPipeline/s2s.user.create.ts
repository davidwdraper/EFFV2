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
 * - Use the hydrated DtoBag<DbUserDto> from ctx["bag"] to call the `user`
 *   service's `create` operation via SvcClient.call().
 * - Requires the hashed password outputs from CodePasswordHashHandler to be present
 *   (pipeline ordering invariant), even though this handler does not mutate the bag.
 * - On success, the existing ctx["bag"] remains the MOS edge view; this handler
 *   MUST NOT reassign ctx["bag"] (hydrate is the sole writer).
 *
 * Invariants:
 * - Auth remains a MOS (no direct DB writes).
 * - This handler NEVER calls ctx.set("bag", ...).
 * - Controller owns routing metadata for downstream services (slug/version).
 * - On failure, sets handlerStatus="error" via NvHandlerError on ctx["error"].
 * - Additionally, this handler stamps an explicit signup.userCreateStatus flag
 *   on the ctx bus so downstream transactional handlers (rollback, audit, etc.)
 *   can reason about whether the user record was created.
 *
 * Testing (dist-first sidecar):
 * - This handler does NOT import its sibling *.test.ts module.
 * - The test-runner loads "<handlerName>.test.js" from dist via require().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DbUserDto } from "@nv/shared/dto/db.user.dto";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";

type UserBag = DtoBag<DbUserDto>;

type UserCreateStatus =
  | { ok: true; userId: string }
  | { ok: false; code: string; message: string };

export class S2sUserCreateHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Call the user service create endpoint with the hydrated DbUserDto bag while leaving ctx['bag'] untouched.";
  }

  protected handlerName(): string {
    return "s2s.user.create";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    // ───────────────────────────────────────────
    // Inputs (no seeder; upstream handlers/controller are responsible)
    // ───────────────────────────────────────────

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
          "Auth signup pipeline expected ctx['bag'] to contain a DtoBag<DbUserDto> before calling user.create. " +
          "Dev: ensure controller hydration stored the bag under ctx['bag'].",
        stage: "inputs.userBag",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasBag: !!bag }],
        logMessage: "auth.signup.s2s.user.create: ctx['bag'] missing.",
        logLevel: "error",
      });
      return;
    }

    // Derive userId from the hydrated DTO in the bag (canonical id is dto._id).
    const items: any[] = (bag as any)?.items;
    if (!Array.isArray(items) || items.length !== 1) {
      const status: UserCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_USER_BAG_INVALID",
        message: "Ctx['bag'] did not contain exactly one user DTO.",
      };
      this.ctx.set("signup.userCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_bag_invalid",
        detail:
          "Auth signup expected ctx['bag'] to contain exactly one DbUserDto before calling user.create.",
        stage: "inputs.userBag.items",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasItems: Array.isArray(items), count: items?.length }],
        logMessage:
          "auth.signup.s2s.user.create: bag.items invalid (expected exactly 1).",
        logLevel: "error",
      });
      return;
    }

    const dto = items[0] as DbUserDto;
    const userId = typeof (dto as any)?.getId === "function" ? dto.getId() : "";

    if (!userId) {
      const status: UserCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_USER_ID_MISSING",
        message: "Hydrated user DTO did not expose a valid id.",
      };
      this.ctx.set("signup.userCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_id_missing",
        detail:
          "Auth signup expected the hydrated user DTO to contain a valid _id before calling user.create. " +
          "Dev: controller hydration must enforce _id (ADR-0102).",
        stage: "inputs.userDto.id",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasUserId: !!userId }],
        logMessage: "auth.signup.s2s.user.create: hydrated DTO missing id.",
        logLevel: "error",
      });
      return;
    }

    // Password-hash rung ordering invariant (Step 1 must have run).
    const passwordHash = this.safeCtxGet<string>("signup.passwordHash");
    const passwordAlgo = this.safeCtxGet<string>("signup.passwordAlgo");
    const passwordHashParamsJson = this.safeCtxGet<string>(
      "signup.passwordHashParamsJson"
    );
    const passwordCreatedAt = this.safeCtxGet<string>(
      "signup.passwordCreatedAt"
    );

    if (
      !passwordHash ||
      !passwordAlgo ||
      !passwordHashParamsJson ||
      !passwordCreatedAt
    ) {
      const status: UserCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_MISSING_PASSWORD_HASH",
        message:
          "Password hash outputs were missing before user.create (expected passwordHash step to run).",
      };
      this.ctx.set("signup.userCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_missing_password_hash",
        detail:
          "Auth signup pipeline expected password-hash outputs to exist before calling user.create. " +
          "Dev: ensure CodePasswordHashHandler ran and set ctx['signup.passwordHash'|'signup.passwordAlgo'|'signup.passwordHashParamsJson'|'signup.passwordCreatedAt'].",
        stage: "inputs.passwordHash",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            hasPasswordHash: !!passwordHash,
            hasPasswordAlgo: !!passwordAlgo,
            hasPasswordHashParamsJson: !!passwordHashParamsJson,
            hasPasswordCreatedAt: !!passwordCreatedAt,
          },
        ],
        logMessage:
          "auth.signup.s2s.user.create: password hash outputs missing before user.create.",
        logLevel: "error",
      });
      return;
    }

    // ───────────────────────────────────────────
    // Runtime config + caps
    // ───────────────────────────────────────────

    const env = (this.rt.getEnv() ?? "").trim();
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
        origin: { file: __filename, method: "execute" },
        issues: [{ env }],
        logMessage: "auth.signup.s2s.user.create: empty env label from rt.",
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
        issues: [{ hasSvcClient: !!svcClient }],
        logMessage:
          "auth.signup.s2s.user.create: missing rt cap s2s.svcClient.",
        logLevel: "error",
      });
      return;
    }

    // Controller-owned routing metadata (do not hardcode).
    const rawSlug = this.ctx.get<unknown>("s2s.slug.user" as any);
    const rawVersion = this.ctx.get<unknown>("s2s.version.user" as any);

    const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
    const version =
      typeof rawVersion === "number" && Number.isFinite(rawVersion)
        ? rawVersion
        : NaN;

    if (!slug || !Number.isFinite(version)) {
      const status: UserCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_S2S_ROUTE_META_MISSING",
        message:
          "Missing or invalid controller-seeded s2s route metadata for user (slug/version).",
      };
      this.ctx.set("signup.userCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_s2s_route_meta_missing",
        detail:
          "Auth signup requires controller-seeded S2S routing metadata before calling user.create. " +
          "Dev: controller must set ctx['s2s.slug.user'] (string) and ctx['s2s.version.user'] (number).",
        stage: "config.s2s.routeMeta",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ rawSlug, rawVersion }],
        logMessage:
          "auth.signup.s2s.user.create: missing/invalid s2s.slug.user or s2s.version.user.",
        logLevel: "error",
      });
      return;
    }

    // ───────────────────────────────────────────
    // S2S call
    // ───────────────────────────────────────────

    try {
      const _wire = await svcClient.call({
        env,
        slug,
        version,
        dtoType: "user",
        op: "create",
        method: "PUT",
        bag,
        requestId,
      });
      void _wire;

      const status: UserCreateStatus = {
        ok: true,
        userId,
      };
      this.ctx.set("signup.userCreateStatus", status);
      this.ctx.set("handlerStatus", "success");
      return;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");

      let downstreamStatus: number | undefined;
      if (err instanceof Error) {
        const m = err.message.match(/status=(\d{3})/);
        if (m && m[1]) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) downstreamStatus = n;
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
        origin: { file: __filename, method: "execute" },
        issues: [{ env, slug, op: "create", downstreamStatus }],
        rawError: err,
        logMessage: isDuplicate
          ? "auth.signup.s2s.user.create: duplicate (mapped to 409)."
          : "auth.signup.s2s.user.create: s2s call failed.",
        logLevel: isDuplicate ? "warn" : "error",
      });
      return;
    }
  }
}
