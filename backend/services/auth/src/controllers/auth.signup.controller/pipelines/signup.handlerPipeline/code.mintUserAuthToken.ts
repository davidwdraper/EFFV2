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
 * Env (from svcEnv, NOT process.env):
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
 * - ctx["signup.jwt"]            → compact JWT string
 * - ctx["signup.jwtHeader"]      → { alg, kid }
 * - ctx["signup.jwtIssuedAt"]    → epoch seconds
 * - ctx["signup.jwtExpiresAt"]   → epoch seconds
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

import { MinterEnv } from "@nv/shared/security/MinterEnv";
import { Minter } from "@nv/shared/security/Minter";
import {
  MintProvider,
  type TokenRequest,
  type TokenResult,
} from "@nv/shared/security/MintProvider";
import { KmsJwtSigner } from "@nv/shared/security/KmsJwtSigner";
import type { IBoundLogger } from "@nv/shared/logger/Logger";

type UserCreateStatus =
  | { ok: true; userId?: string }
  | { ok: false; code: string; message: string };

type UserAuthCreateStatus =
  | { ok: true }
  | { ok: false; code: string; message: string };

// Module-level singleton: one MintProvider per process.
// KMS client is expensive; we want to reuse it and cache tokens by tuple.
let tokenProvider: MintProvider | null = null;

// Tiny helper to pull env vars from svcEnv (DTO), not process.env.
type SvcEnvLike =
  | {
      getVar?: (key: string) => string | undefined;
      _vars?: Record<string, string | undefined>;
    }
  | undefined;

function getVarStrict(
  svcEnv: SvcEnvLike,
  key: string,
  requestId: string | undefined
): string {
  const fromGetter =
    svcEnv && typeof svcEnv.getVar === "function"
      ? svcEnv.getVar(key)
      : undefined;
  const fromMap =
    !fromGetter && svcEnv && svcEnv._vars ? svcEnv._vars[key] : undefined;

  const value = fromGetter ?? fromMap;

  if (!value || value.trim() === "") {
    const idPart = requestId ? ` (requestId=${requestId})` : "";
    throw new Error(
      `[AuthMint] Required svcEnv var '${key}' is missing or empty${idPart}`
    );
  }

  return value;
}

function getOrCreateTokenProvider(
  svcEnv: SvcEnvLike,
  log: IBoundLogger,
  requestId: string | undefined
): MintProvider {
  if (tokenProvider) {
    return tokenProvider;
  }

  // Validate/signing env via MinterEnv (no process.env reads here).
  const envShape = {
    KMS_PROJECT_ID: getVarStrict(svcEnv, "KMS_PROJECT_ID", requestId),
    KMS_LOCATION_ID: getVarStrict(svcEnv, "KMS_LOCATION_ID", requestId),
    KMS_KEY_RING_ID: getVarStrict(svcEnv, "KMS_KEY_RING_ID", requestId),
    KMS_KEY_ID: getVarStrict(svcEnv, "KMS_KEY_ID", requestId),
    KMS_KEY_VERSION: getVarStrict(svcEnv, "KMS_KEY_VERSION", requestId),
    KMS_JWT_ALG: getVarStrict(svcEnv, "KMS_JWT_ALG", requestId),
    NV_ISSUER: getVarStrict(svcEnv, "NV_ISSUER", requestId),
  };

  const minterEnv = MinterEnv.assert(envShape as NodeJS.ProcessEnv);

  const signer = new KmsJwtSigner(
    {
      KMS_PROJECT_ID: minterEnv.KMS_PROJECT_ID,
      KMS_LOCATION_ID: minterEnv.KMS_LOCATION_ID,
      KMS_KEY_RING_ID: minterEnv.KMS_KEY_RING_ID,
      KMS_KEY_ID: minterEnv.KMS_KEY_ID,
      KMS_KEY_VERSION: minterEnv.KMS_KEY_VERSION,
      KMS_JWT_ALG: minterEnv.KMS_JWT_ALG,
    },
    { log }
  );

  const minter = new Minter({ signer, log });

  const earlyRefreshSec = Number(
    getVarStrict(svcEnv, "NV_AUTH_TOKEN_EARLY_REFRESH_SEC", requestId)
  );
  const clockSkewSec = Number(
    getVarStrict(svcEnv, "NV_AUTH_TOKEN_CLOCK_SKEW_SEC", requestId)
  );

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
    log,
  });

  return tokenProvider;
}

export class CodeMintUserAuthTokenHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  protected handlerPurpose(): string {
    return "Mint a client-facing auth JWT for a successfully created user and user-auth pair in the signup MOS pipeline.";
  }

  protected override async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

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
        issues: [
          {
            hasUserId: !!userId,
          },
        ],
        logMessage:
          "auth.signup.mintUserAuthToken: missing signup.userId; cannot mint token",
        logLevel: "error",
      });
      return;
    }

    const controller = this.controller as ControllerBase;
    const app = controller.getApp?.() as
      | {
          getEnvLabel?: () => string;
          getSvcEnv?: () => unknown;
        }
      | undefined;

    if (!app || typeof app.getSvcEnv !== "function") {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_mint_svcenv_unavailable",
        detail:
          "Auth signup could not access svcEnv when minting an auth token. " +
          "Dev: ensure AuthApp extends AppBase and exposes getSvcEnv().",
        stage: "svcenv.resolve",
        requestId,
        origin: {
          file: __filename,
          method: "execute",
        },
        issues: [
          {
            hasApp: !!app,
            hasGetSvcEnv: !!app && typeof app.getSvcEnv === "function",
          },
        ],
        logMessage:
          "auth.signup.mintUserAuthToken: AppBase.getSvcEnv() unavailable",
        logLevel: "error",
      });
      return;
    }

    const svcEnv = app.getSvcEnv() as SvcEnvLike;
    const envLabel =
      typeof app.getEnvLabel === "function" ? app.getEnvLabel() : undefined;

    let provider: MintProvider;
    let aud: string;
    let ttlSec: number;
    let nbfSkewSec: number;

    // ───────────────────────────────────────────────────────────────
    // 1) Build MintProvider (KMS client, Minter) and env knobs
    // ───────────────────────────────────────────────────────────────
    try {
      provider = getOrCreateTokenProvider(svcEnv, this.log, requestId);

      aud = getVarStrict(svcEnv, "NV_AUTH_TOKEN_AUD", requestId);
      const ttlSecRaw = getVarStrict(
        svcEnv,
        "NV_AUTH_TOKEN_TTL_SEC",
        requestId
      );
      const nbfSkewRaw = getVarStrict(
        svcEnv,
        "NV_AUTH_TOKEN_NBF_SKEW_SEC",
        requestId
      );

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
      const message =
        err instanceof Error
          ? err.message
          : "Unknown env/KMS configuration error";

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
        issues: [
          {
            env: envLabel ?? null,
          },
        ],
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
    const req: TokenRequest = {
      aud,
      iss: getVarStrict(svcEnv, "NV_ISSUER", requestId),
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

      this.ctx.set("signup.jwt", result.jwt);
      this.ctx.set("signup.jwtHeader", result.header);
      this.ctx.set("signup.jwtIssuedAt", result.issuedAt);
      this.ctx.set("signup.jwtExpiresAt", result.expiresAt);

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
      const message = err instanceof Error ? err.message : "Unknown error";

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
        issues: [
          {
            sub: userId,
            aud,
            env: envLabel ?? null,
          },
        ],
        rawError: err,
        logMessage:
          "auth.signup.mintUserAuthToken: token mint FAILED via MintProvider.getToken().",
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
      "auth.signup.mintUserAuthToken: exit handler"
    );
  }
}
