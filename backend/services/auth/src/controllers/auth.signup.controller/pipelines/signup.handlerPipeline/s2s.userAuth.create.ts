// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.userAuth.create.ts
/**
 * Docs:
 * - SOP: DTO-first persistence via worker services.
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0044 (DbEnvServiceDto — Key/Value Contract)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *   - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *
 * Purpose:
 * - Construct a DtoBag<DbUserAuthDto> for the auth storage worker using:
 *   • userId (derived from hydrated ctx["bag"] user DTO)
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
 * - DTOs are created only via the app registry (ADR-0102).
 * - No silent fallbacks: missing required signup keys hard-fail with ops guidance.
 *
 * Rail semantics (IMPORTANT):
 * - If user-auth.create fails, this handler MUST NOT hard-fail the pipeline.
 * - Instead it sets:
 *     ctx["signup.rollbackUserRequired"] = true
 *     ctx["signup.userAuthCreateStatus"] = { ok:false, ... }
 *   and keeps handlerStatus="success" so the pipeline can proceed to the rollback step.
 */

import { DtoBag } from "@nv/shared/dto/DtoBag";
import type { DbUserAuthDto } from "@nv/shared/dto/db.user-auth.dto";

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { SvcClient } from "@nv/shared/s2s/SvcClient";
import type { DbUserDto } from "@nv/shared/dto/db.user.dto";

type UserAuthBag = DtoBag<DbUserAuthDto>;

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

export class S2sUserAuthCreateHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Build a DbUserAuthDto bag from signup context and call the user-auth worker create operation via SvcClient.";
  }

  protected handlerName(): string {
    return "s2s.userAuth.create";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    // Default: rollback not required unless we explicitly set it on failure.
    this.ctx.set("signup.rollbackUserRequired", false);

    // ───────────────────────────────────────────
    // Derive userId from hydrated user DTO bag (canonical id is dto._id)
    // ───────────────────────────────────────────

    const userBag = this.safeCtxGet<DtoBag<DbUserDto>>("bag");
    const userItems: any[] = (userBag as any)?.items;

    if (!userBag || !Array.isArray(userItems) || userItems.length !== 1) {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_MISSING_USER_BAG",
        message:
          "Missing or invalid ctx['bag'] before user-auth.create (expected exactly one user DTO).",
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      // Missing bag is a DEV bug: hard fail immediately (no rollback step).
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_missing_user_bag",
        detail:
          "Auth signup expected ctx['bag'] to contain exactly one hydrated DbUserDto before calling user-auth.create. " +
          "Dev: ensure controller hydration seeded ctx['bag'] correctly.",
        stage: "inputs.userBag",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasBag: !!userBag, count: userItems?.length }],
        logMessage:
          "auth.signup.s2s.userAuth.create: missing/invalid user bag before user-auth.create.",
        logLevel: "error",
      });
      return;
    }

    const userDto = userItems[0] as DbUserDto;
    const userId =
      typeof (userDto as any)?.getId === "function" ? userDto.getId() : "";

    if (!userId) {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_USER_ID_MISSING",
        message: "Hydrated user DTO did not expose a valid id.",
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_id_missing",
        detail:
          "Auth signup expected the hydrated user DTO to contain a valid _id before calling user-auth.create. " +
          "Dev: controller hydration must enforce _id (ADR-0102).",
        stage: "inputs.userDto.id",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasUserId: !!userId }],
        logMessage:
          "auth.signup.s2s.userAuth.create: hydrated user DTO missing id.",
        logLevel: "error",
      });
      return;
    }

    // ── Required signup fields ──
    const passwordHash = this.safeCtxGet<string>("signup.passwordHash");
    const passwordAlgo = this.safeCtxGet<string>("signup.passwordAlgo");
    const passwordHashParamsJson = this.safeCtxGet<string>(
      "signup.passwordHashParamsJson"
    );
    const passwordCreatedAt = this.safeCtxGet<string>(
      "signup.passwordCreatedAt"
    );

    if (!passwordHash || !passwordAlgo || !passwordCreatedAt) {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_MISSING_AUTH_FIELDS",
        message:
          "Missing one or more required keys: signup.passwordHash, signup.passwordAlgo, signup.passwordCreatedAt.",
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      // Missing inputs is a DEV bug: hard fail immediately (no rollback step).
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_missing_auth_fields",
        detail:
          "Auth signup expected password-hash outputs to be populated before calling user-auth.create. " +
          "Dev: ensure CodePasswordHashHandler ran and stored these values. No fallbacks here.",
        stage: "inputs.authFields",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [
          {
            hasPasswordHash: !!passwordHash,
            hasPasswordAlgo: !!passwordAlgo,
            hasPasswordCreatedAt: !!passwordCreatedAt,
            hasPasswordHashParamsJson: !!passwordHashParamsJson,
          },
        ],
        logMessage:
          "auth.signup.s2s.userAuth.create: required signup auth fields missing.",
        logLevel: "error",
      });
      return;
    }

    // ───────────────────────────────────────────
    // Mint DTO via app DTO registry (ADR-0102 / Scenario A)
    // ───────────────────────────────────────────

    let userAuthDto: DbUserAuthDto;
    try {
      const reg = this.getRegistry();
      userAuthDto = reg.create<DbUserAuthDto>("db.user-auth.dto", undefined, {
        validate: true,
      });

      // NOTE: setters are DTO-defined; we do not construct raw JSON.
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

      // DTO build failure is a DEV bug: hard fail (no rollback step).
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_user_auth_dto_invalid",
        detail:
          "Auth signup failed while constructing DbUserAuthDto from in-memory data via the app DTO registry. " +
          "Dev: verify the DTO registration key (db.user-auth.dto) and setter validations.",
        stage: "dto.build",
        requestId,
        origin: { file: __filename, method: "execute" },
        rawError: err,
        logMessage:
          "auth.signup.s2s.userAuth.create: DbUserAuthDto construction failed.",
        logLevel: "error",
      });
      return;
    }

    const bag: UserAuthBag = new DtoBag<DbUserAuthDto>([userAuthDto]);

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

    // Controller-owned routing metadata (do not hardcode).
    const rawSlug = this.ctx.get<unknown>("s2s.slug.userAuth" as any);
    const rawVersion = this.ctx.get<unknown>("s2s.version.userAuth" as any);

    const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
    const version =
      typeof rawVersion === "number" && Number.isFinite(rawVersion)
        ? rawVersion
        : NaN;

    if (!slug || !Number.isFinite(version)) {
      const status: UserAuthCreateStatus = {
        ok: false,
        code: "AUTH_SIGNUP_S2S_ROUTE_META_MISSING",
        message:
          "Missing or invalid controller-seeded s2s route metadata for user-auth (slug/version).",
      };
      this.ctx.set("signup.userAuthCreateStatus", status);

      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_userauth_route_meta_missing",
        detail:
          "Auth signup requires controller-seeded S2S routing metadata before calling user-auth.create. " +
          "Dev: controller must set ctx['s2s.slug.userAuth'] (string) and ctx['s2s.version.userAuth'] (number).",
        stage: "config.s2s.routeMeta.userAuth",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ rawSlug, rawVersion }],
        logMessage:
          "auth.signup.s2s.userAuth.create: missing/invalid s2s.slug.userAuth or s2s.version.userAuth.",
        logLevel: "error",
      });
      return;
    }

    // ── External S2S call to user-auth worker ──
    try {
      const _wire = await svcClient.call({
        env,
        slug,
        version,
        dtoType: "user-auth",
        op: "create",
        method: "PUT",
        bag,
        requestId,
      });
      void _wire;

      this.ctx.set("signup.userAuthCreateStatus", { ok: true });
      this.ctx.set("signup.rollbackUserRequired", false);
      this.ctx.set("handlerStatus", "success");
      return;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Unknown error");

      // SOFT FAIL:
      // - Continue so the rollback step can run.
      // - Mark rollback required and keep handlerStatus="success".
      this.ctx.set("signup.userAuthCreateStatus", {
        ok: false,
        code: "AUTH_SIGNUP_USER_AUTH_CREATE_FAILED",
        message,
      });

      this.ctx.set("signup.rollbackUserRequired", true);
      this.ctx.set("handlerStatus", "success");

      this.log.error(
        {
          event: "user_auth_create_failed_soft",
          requestId,
          env,
          slug,
          version,
          message,
        },
        "auth.signup.s2s.userAuth.create: user-auth.create FAILED (soft-fail; rollback required)"
      );

      return;
    }
  }
}
