// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.mintUserAuthToken.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0035 (JWKS Service for Public Keys)
 *   - ADR-0036 (Token Minter using GCP KMS Sign)
 *   - ADR-0040 (DTO-Only Persistence via Managers)
 *   - ADR-0044 (EnvServiceDto — Key/Value Contract)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *   - ADR-0071 (Auth Signup JWT Placement — ctx + meta.tokens.userAuth)
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Purpose (single concern):
 * - Mint a client-facing auth JWT for a successfully created user + user-auth
 *   pair in the signup MOS pipeline.
 *
 * Inputs (from ctx):
 * - ctx["signup.userId"]                 → subject (sub)
 * - ctx["signup.userCreateStatus"]      → { ok: true/false, ... }
 * - ctx["signup.userAuthCreateStatus"]  → { ok: true/false, ... }
 *
 * Env (from env-service via getVar, NOT process.env):
 * - KMS_PROJECT_ID
 * - KMS_LOCATION_ID
 * - KMS_KEY_RING_ID
 * - KMS_KEY_ID
 * - KMS_KEY_VERSION
 * - KMS_JWT_ALG
 * - NV_ISSUER
 * - NV_AUTH_TOKEN_AUD
 * - NV_AUTH_TOKEN_TTL_SEC
 * - NV_AUTH_TOKEN_NBF_SKEW_SEC
 * - NV_AUTH_TOKEN_EARLY_REFRESH_SEC
 * - NV_AUTH_TOKEN_CLOCK_SKEW_SEC
 *
 * Outputs (on ctx):
 * - ctx["signup.jwt"]            → compact JWT string (internal trace)
 * - ctx["signup.jwtHeader"]      → { alg, kid }
 * - ctx["signup.jwtIssuedAt"]    → epoch seconds
 * - ctx["signup.jwtExpiresAt"]   → epoch seconds
 *
 * Canonical JWT placement (ADR-0071):
 * - ctx["jwt.userAuth"]          → compact JWT string for finalizer
 *
 * Invariants:
 * - Does NOT mutate ctx["bag"]; edge response remains the UserDto bag.
 * - Does NOT roll back persistence; minting failure is an edge concern, not a
 *   DB transaction concern.
 * - Only runs meaningfully when both userCreateStatus.ok === true and
 *   userAuthCreateStatus.ok === true; otherwise it no-ops.
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { SvcRuntime } from "@nv/shared/runtime/SvcRuntime";

import { MinterEnv, type MinterEnvShape } from "@nv/shared/security/MinterEnv";
import { Minter } from "@nv/shared/security/Minter";
import {
  MintProvider,
  type TokenRequest,
  type TokenResult,
} from "@nv/shared/security/MintProvider";
import { KmsJwtSigner } from "@nv/shared/security/KmsJwtSigner";

// Test harness wiring
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { MintUserAuthTokenHappyScenario } from "./code.mintUserAuthToken.test";

// Status summaries from upstream handlers
type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

// Module-level singleton: one MintProvider per process.
// KMS client is expensive; we want to reuse it and cache tokens by tuple.
let tokenProvider: MintProvider | null = null;

export class CodeMintUserAuthTokenHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  /**
   * Stable handler name for logging + test discovery.
   */
  public handlerName(): string {
    return "code.mintUserAuthToken";
  }

  /**
   * Test hook used by the handler-level test harness:
   * - Uses the same scenario entrypoint as the test-runner (CodeMintUserAuthTokenTest).
   */
  public override async runTest(): Promise<HandlerTestResult | undefined> {
    return this.runSingleTest(MintUserAuthTokenHappyScenario);
  }

  protected handlerPurpose(): string {
    return "Mint a client-facing auth JWT for a successfully created user and user-auth pair in the signup MOS pipeline.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.getRequestId();

    const userCreateStatus = this.safeCtxGet<UserCreateStatus>(
      "signup.userCreateStatus"
    );
    const userAuthCreateStatus = this.safeCtxGet<UserAuthCreateStatus>(
      "signup.userAuthCreateStatus"
    );
    const userId = this.safeCtxGet<string>("signup.userId");

    // If the upstream operations did not succeed, this handler is a no-op.
    if (!userCreateStatus || userCreateStatus.ok !== true) {
      this.log.debug(
        {
          event: "mint_skip_user_not_ok",
          requestId,
        },
        "auth.signup.mintUserAuthToken: userCreateStatus not ok — skipping mint"
      );
      return;
    }

    if (!userAuthCreateStatus || userAuthCreateStatus.ok !== true) {
      this.log.debug(
        {
          event: "mint_skip_user_auth_not_ok",
          requestId,
        },
        "auth.signup.mintUserAuthToken: userAuthCreateStatus not ok — skipping mint"
      );
      return;
    }

    if (!userId || userId.trim().length === 0) {
      // Dev bug: we cannot mint a token without a subject.
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_mint_missing_user_id",
        detail:
          "Auth signup reached the token minting step but ctx['signup.userId'] was missing or empty. " +
          "Dev: ensure BuildSignupUserIdHandler runs and persists signup.userId on the ctx bus.",
        stage: "preconditions.userId",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ hasUserId: !!userId }],
        logMessage:
          "auth.signup.mintUserAuthToken: missing signup.userId; cannot mint token",
        logLevel: "error",
      });
      return;
    }

    // Diagnostics-only env label from SvcRuntime (no app fishing)
    let envLabel: string | undefined;
    try {
      const rt = this.safeCtxGet<SvcRuntime>("rt");
      const e = (rt?.getEnv?.() ?? "").toString().trim();
      envLabel = e ? e : undefined;
    } catch {
      envLabel = undefined;
    }

    let provider: MintProvider;
    let aud: string;
    let ttlSec: number;
    let nbfSkewSec: number;

    // ───────────────────────────────────────────────────────────────
    // 1) Build MintProvider (KMS client, Minter) and env knobs
    //    using HandlerBase.getVar(key, required:true)
    // ───────────────────────────────────────────────────────────────
    try {
      if (!tokenProvider) {
        const algRaw = this.getVar("KMS_JWT_ALG", true);

        // Runtime guard to satisfy both TS and Ops
        if (
          algRaw !== "RS256" &&
          algRaw !== "RS384" &&
          algRaw !== "RS512" &&
          algRaw !== "ES256" &&
          algRaw !== "ES384" &&
          algRaw !== "ES512"
        ) {
          throw new Error(
            `[AuthMint] KMS_JWT_ALG must be one of RS256, RS384, RS512, ES256, ES384, ES512 (got '${algRaw}')`
          );
        }

        const envShape: MinterEnvShape = {
          KMS_PROJECT_ID: this.getVar("KMS_PROJECT_ID", true),
          KMS_LOCATION_ID: this.getVar("KMS_LOCATION_ID", true),
          KMS_KEY_RING_ID: this.getVar("KMS_KEY_RING_ID", true),
          KMS_KEY_ID: this.getVar("KMS_KEY_ID", true),
          KMS_KEY_VERSION: this.getVar("KMS_KEY_VERSION", true),
          KMS_JWT_ALG: algRaw as MinterEnvShape["KMS_JWT_ALG"],
          NV_ISSUER: this.getVar("NV_ISSUER", true),
        };

        const minterEnv = MinterEnv.assert(envShape);

        const signer = new KmsJwtSigner(
          {
            KMS_PROJECT_ID: minterEnv.KMS_PROJECT_ID,
            KMS_LOCATION_ID: minterEnv.KMS_LOCATION_ID,
            KMS_KEY_RING_ID: minterEnv.KMS_KEY_RING_ID,
            KMS_KEY_ID: minterEnv.KMS_KEY_ID,
            KMS_KEY_VERSION: minterEnv.KMS_KEY_VERSION,
            KMS_JWT_ALG: minterEnv.KMS_JWT_ALG,
          },
          { log: this.log }
        );

        const minter = new Minter({ signer, log: this.log });

        const earlyRefreshSecRaw = this.getVar(
          "NV_AUTH_TOKEN_EARLY_REFRESH_SEC",
          true
        );
        const clockSkewSecRaw = this.getVar(
          "NV_AUTH_TOKEN_CLOCK_SKEW_SEC",
          true
        );

        const earlyRefreshSec = Number(earlyRefreshSecRaw);
        const clockSkewSec = Number(clockSkewSecRaw);

        if (!Number.isFinite(earlyRefreshSec) || earlyRefreshSec <= 0) {
          throw new Error(
            "[AuthMint] NV_AUTH_TOKEN_EARLY_REFRESH_SEC must be a positive number (sec)"
          );
        }
        if (!Number.isFinite(clockSkewSec) || clockSkewSec < 0) {
          throw new Error(
            "[AuthMint] NV_AUTH_TOKEN_CLOCK_SKEW_SEC must be a non-negative number (sec)"
          );
        }

        tokenProvider = new MintProvider({
          earlyRefreshSec,
          clockSkewSec,
          minter,
          signer,
          log: this.log,
        });

        this.log.info(
          {
            event: "mint_provider_init",
            kid: `kms:${minterEnv.KMS_PROJECT_ID}:${minterEnv.KMS_LOCATION_ID}:${minterEnv.KMS_KEY_RING_ID}:${minterEnv.KMS_KEY_ID}:v${minterEnv.KMS_KEY_VERSION}`,
            alg: minterEnv.KMS_JWT_ALG,
          },
          "MintProvider: initialized"
        );
      }

      provider = tokenProvider!;

      aud = this.getVar("NV_AUTH_TOKEN_AUD", true);
      const ttlSecRaw = this.getVar("NV_AUTH_TOKEN_TTL_SEC", true);
      const nbfSkewRaw = this.getVar("NV_AUTH_TOKEN_NBF_SKEW_SEC", true);

      ttlSec = Number(ttlSecRaw);
      nbfSkewSec = Number(nbfSkewRaw);

      if (!Number.isFinite(ttlSec) || ttlSec <= 0) {
        throw new Error(
          "[AuthMint] NV_AUTH_TOKEN_TTL_SEC must be a positive number (sec)"
        );
      }
      if (!Number.isFinite(nbfSkewSec)) {
        throw new Error(
          "[AuthMint] NV_AUTH_TOKEN_NBF_SKEW_SEC must be a finite number (sec)"
        );
      }
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_mint_env_invalid",
        detail:
          "Auth signup failed while validating KMS/JWT environment configuration. " +
          "Ops: inspect KMS_* vars, NV_ISSUER, NV_AUTH_TOKEN_* vars in env-service for this service.",
        stage: "mint.env_config",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ env: envLabel ?? null }],
        rawError: err,
        logMessage:
          "auth.signup.mintUserAuthToken: invalid or missing env vars for auth token minting.",
        logLevel: "error",
      });
      return;
    }

    // ───────────────────────────────────────────────────────────────
    // 2) Construct token request and call MintProvider
    // ───────────────────────────────────────────────────────────────
    const iss = this.getVar("NV_ISSUER", true);

    const req: TokenRequest = {
      aud,
      iss,
      sub: userId,
      ttlSec,
      nbfSkewSec,
      extra: {
        type: "client",
        svc: "auth",
        env: envLabel ?? null,
      },
    };

    this.log.debug(
      {
        event: "mint_begin",
        requestId,
        aud,
        ttlSec,
        nbfSkewSec,
        env: envLabel ?? null,
      },
      "auth.signup.mintUserAuthToken: mint begin"
    );

    try {
      const result: TokenResult = await provider.getToken(req);

      // Internal trace fields for diagnostics
      this.ctx.set("signup.jwt", result.jwt);
      this.ctx.set("signup.jwtHeader", result.header);
      this.ctx.set("signup.jwtIssuedAt", result.issuedAt);
      this.ctx.set("signup.jwtExpiresAt", result.expiresAt);

      // Canonical placement for user auth JWT (ADR-0071)
      this.ctx.set("jwt.userAuth", result.jwt);

      this.log.info(
        {
          event: "mint_ok",
          requestId,
          sub: userId,
          aud,
          iat: result.issuedAt,
          exp: result.expiresAt,
        },
        "auth.signup.mintUserAuthToken: mint ok"
      );

      // On success we intentionally do NOT touch handlerStatus.
      // Persistence has already succeeded; minting is an edge concern.
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_mint_failed",
        detail:
          "Auth signup created the user and user-auth records, but minting the auth token failed. " +
          "Ops: inspect KMS configuration (KMS_* vars), NV_ISSUER, NV_AUTH_TOKEN_* vars, " +
          "and network/IAM access to the KMS key. Existing records are valid, but the client did not receive a token.",
        stage: "mint.provider_getToken",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [{ sub: userId, aud, env: envLabel ?? null }],
        rawError: err,
        logMessage:
          "auth.signup.mintUserAuthToken: token mint FAILED via MintProvider.getToken().",
        logLevel: "error",
      });
      return;
    }

    this.log.debug(
      {
        event: "execute_end",
        handler: this.constructor.name,
        requestId,
        handlerStatus: this.safeCtxGet<string>("handlerStatus") ?? "ok",
      },
      "auth.signup.mintUserAuthToken: exit handler"
    );
  }
}
