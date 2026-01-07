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
 *
 * Testing (dist-first sidecar):
 * - This handler does NOT import its sibling *.test.ts module.
 * - The test-runner loads "<handlerName>.test.js" from dist via require().
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { MinterEnv, type MinterEnvShape } from "@nv/shared/security/MinterEnv";
import { Minter } from "@nv/shared/security/Minter";
import {
  MintProvider,
  type TokenRequest,
  type TokenResult,
} from "@nv/shared/security/MintProvider";
import { KmsJwtSigner } from "@nv/shared/security/KmsJwtSigner";

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

function assertAlg(raw: string): MinterEnvShape["KMS_JWT_ALG"] {
  if (
    raw === "RS256" ||
    raw === "RS384" ||
    raw === "RS512" ||
    raw === "ES256" ||
    raw === "ES384" ||
    raw === "ES512"
  ) {
    return raw;
  }
  throw new Error(
    `[AuthMint] KMS_JWT_ALG must be one of RS256, RS384, RS512, ES256, ES384, ES512 (got '${raw}')`
  );
}

function mustPositiveNumber(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[AuthMint] ${label} must be a positive number (sec)`);
  }
  return n;
}

function mustFiniteNumber(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`[AuthMint] ${label} must be a finite number (sec)`);
  }
  return n;
}

function mustNonNegativeNumber(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`[AuthMint] ${label} must be a non-negative number (sec)`);
  }
  return n;
}

export class CodeMintUserAuthTokenHandler extends HandlerBase {
  public constructor(ctx: HandlerContext, controller: ControllerBase) {
    super(ctx, controller);
  }

  public handlerName(): string {
    return "code.mintUserAuthToken";
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

    // No-op unless upstream persistence succeeded.
    if (!userCreateStatus || userCreateStatus.ok !== true) return;
    if (!userAuthCreateStatus || userAuthCreateStatus.ok !== true) return;

    if (!userId || userId.trim().length === 0) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_mint_missing_user_id",
        detail:
          "Auth signup reached the token minting step but ctx['signup.userId'] was missing or empty. " +
          "Dev: ensure the pipeline writes signup.userId before minting.",
        stage: "preconditions.userId",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ hasUserId: !!userId }],
        logMessage:
          "auth.signup.code.mintUserAuthToken: missing signup.userId; cannot mint token.",
        logLevel: "error",
      });
      return;
    }

    // Diagnostics-only env label from SvcRuntime (not from ctx).
    const envLabelRaw = (this.rt.getEnv() ?? "").toString().trim();
    const envLabel = envLabelRaw ? envLabelRaw : undefined;

    let provider: MintProvider;
    let aud: string;
    let ttlSec: number;
    let nbfSkewSec: number;

    // ───────────────────────────────────────────────────────────────
    // 1) Build MintProvider singleton + parse env knobs (getVar only)
    // ───────────────────────────────────────────────────────────────
    try {
      if (!tokenProvider) {
        const alg = assertAlg(this.getVar("KMS_JWT_ALG", true));

        const envShape: MinterEnvShape = {
          KMS_PROJECT_ID: this.getVar("KMS_PROJECT_ID", true),
          KMS_LOCATION_ID: this.getVar("KMS_LOCATION_ID", true),
          KMS_KEY_RING_ID: this.getVar("KMS_KEY_RING_ID", true),
          KMS_KEY_ID: this.getVar("KMS_KEY_ID", true),
          KMS_KEY_VERSION: this.getVar("KMS_KEY_VERSION", true),
          KMS_JWT_ALG: alg,
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

        const earlyRefreshSec = mustPositiveNumber(
          this.getVar("NV_AUTH_TOKEN_EARLY_REFRESH_SEC", true),
          "NV_AUTH_TOKEN_EARLY_REFRESH_SEC"
        );
        const clockSkewSec = mustNonNegativeNumber(
          this.getVar("NV_AUTH_TOKEN_CLOCK_SKEW_SEC", true),
          "NV_AUTH_TOKEN_CLOCK_SKEW_SEC"
        );

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

      provider = tokenProvider;

      aud = this.getVar("NV_AUTH_TOKEN_AUD", true);
      ttlSec = mustPositiveNumber(
        this.getVar("NV_AUTH_TOKEN_TTL_SEC", true),
        "NV_AUTH_TOKEN_TTL_SEC"
      );
      nbfSkewSec = mustFiniteNumber(
        this.getVar("NV_AUTH_TOKEN_NBF_SKEW_SEC", true),
        "NV_AUTH_TOKEN_NBF_SKEW_SEC"
      );
    } catch (err) {
      this.failWithError({
        httpStatus: 500,
        title: "auth_signup_mint_env_invalid",
        detail:
          "Auth signup failed while validating KMS/JWT environment configuration. " +
          "Ops: inspect KMS_* vars, NV_ISSUER, NV_AUTH_TOKEN_* vars in env-service for this service.",
        stage: "mint.env_config",
        requestId,
        origin: { file: __filename, method: "execute" },
        issues: [{ env: envLabel ?? null }],
        rawError: err,
        logMessage:
          "auth.signup.code.mintUserAuthToken: invalid or missing env vars for auth token minting.",
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

    try {
      const result: TokenResult = await provider.getToken(req);

      // Internal trace fields (never log raw JWT).
      this.ctx.set("signup.jwt", result.jwt);
      this.ctx.set("signup.jwtHeader", result.header);
      this.ctx.set("signup.jwtIssuedAt", result.issuedAt);
      this.ctx.set("signup.jwtExpiresAt", result.expiresAt);

      // Canonical placement (ADR-0071)
      this.ctx.set("jwt.userAuth", result.jwt);

      this.ctx.set("handlerStatus", "ok");
      return;
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
        origin: { file: __filename, method: "execute" },
        issues: [{ sub: userId, aud, env: envLabel ?? null }],
        rawError: err,
        logMessage:
          "auth.signup.code.mintUserAuthToken: token mint failed via MintProvider.getToken().",
        logLevel: "error",
      });
      return;
    }
  }
}
